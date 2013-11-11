// global
var myMask = null;
var app = null;

// app
Ext.define('CustomApp', {
    scopeType: 'release',
    extend: 'Rally.app.App',
    componentCls: 'app',

    launch: function() {
        console.log("launch 2");
        // get the project id.
        this.project = this.getContext().getProject().ObjectID;
        app = this;
        var that = this;
        // get the release (if on a page scoped to the release)
        var tbName = getReleaseTimeBox(this);

        var configs = [];
        
        configs.push({ model : "Project",             
                       fetch : ['Name','ObjectID'], 
                       filters : [] 
        });
        configs.push({ model : "Release",             
                       fetch : ['Name', 'ObjectID', 'Project', 'ReleaseStartDate', 'ReleaseDate' ], 
                       filters:[] 
        });

        async.map( configs, this.wsapiQuery, function(err,results) {
            console.log("results",results);
            that.projects  = results[0];
            that.releases  = results[1];
            that.createReleaseCombo(that.releases);
        });
    },
    
    wsapiQuery : function( config , callback ) {
        Ext.create('Rally.data.WsapiDataStore', {
            autoLoad : true,
            limit : "Infinity",
            model : config.model,
            fetch : config.fetch,
            filters : config.filters,
            sorters : config.sorters,
            listeners : {
                scope : this,
                load : function(store, data) {
                    callback(null,data);
                }
            }
        });
    },
    
    // creates a release drop down combo box with the uniq set of release names
    createReleaseCombo : function(releaseRecords) {
        
        // given a list of all releases (accross sub projects)
        var releases = _.map( releaseRecords, function(rec) { return { name : rec.get("Name"), objectid : rec.get("ObjectID"), releaseDate : new Date(Date.parse(rec.get("ReleaseDate"))), releaseStartDate : new Date(Date.parse(rec.get("ReleaseStartDate"))),isoStart : rec.raw.ReleaseStartDate, isoEnd:rec.raw.ReleaseDate};});
        // get a unique list by name to display in combobox        
        releases = _.uniq( releases, function (r) { return r.name; });
        releases = _.sortBy( releases, function(rec) {return rec.releaseDate;}).reverse();
        // create a store with the set of unique releases
        var releasesStore = Ext.create('Ext.data.Store', {
            fields: ['name','objectid'], data : releases 
        });
        // construct the combo box using the store
        var cb = Ext.create("Ext.ux.CheckCombo", {
            itemId : 'comboRelease',
            fieldLabel: 'Release',
            store: releasesStore,
            queryMode: 'local',
            displayField: 'name',
            valueField: 'name',
            noData : true,
            width: 300,
                
            listeners : {
                scope : this,
                // after collapsing the list
                collapse : function ( field, eOpts ) {
                        this.queryFeatures(releases);
                }
            }
        });
        var container = Ext.create('Ext.container.Container', {
            layout: {
                type: 'hbox',
                align : 'stretch',
                defaultMargins : { top: 5, right: 20, bottom: 0, left: 5 }
            }
        });
        container.add(cb);
        this.add(container);
    },
    
    queryFeatures : function(releases) {
        // get Features for the selected release(s)
        var comboRelease = this.down("#comboRelease");
        var that = this;
        this.rows = [];

        if (comboRelease.getValue()==="") {
            return;
        }

        var selectedR = [];
        // // for each selected release name, select all releases with that name and grab the object id and push it into an 
        // // array. The result will be an array of all matching release that we will use to query for snapshots.
        _.each( comboRelease.getValue().split(","), function (rn) {
            var matching_releases = _.filter( releases, function(r) { return rn == r.name;});
            var uniq_releases = _.uniq(matching_releases, function(r) { return r.name; });
            _.each(uniq_releases,function(release) { selectedR.push(release); });
        });

        if (selectedR.length > 0) {
            myMask = new Ext.LoadMask(Ext.getBody(), {msg:"Please wait..."});
            // myMask.show();
        } else {
            return;
        }

        var filter = null;
        var compFilter = null;
        _.each(selectedR,function(release,i) {
            var f = Ext.create('Rally.data.QueryFilter', {
                property: 'Release.Name',
                operator: '=',
                value: release.name
            });
            filter = i === 0 ? f : filter.or(f);
        });
        
        var fetch = ['ObjectID','FormattedID','Name','LeafStoryCount','AcceptedLeafStoryCount','LeafStoryPlanEstimateTotal','AcceptedLeafStoryPlanEstimateTotal','PercentDoneByStoryCount',"Release","Rank" ];
        fetch = fetch.concat(_.pluck(app.customColumns,"name"));
        console.log("fetch",fetch);
        
        var config = { 
            model  : "PortfolioItem/Feature",
            fetch  : fetch,
            filters: [filter],
            sorters: [{ property: 'Rank', direction: 'ASC'}]
        };
        
        async.map([config], this.wsapiQuery, function(err,results) {
            myMask.hide();
            console.log("# of features in chart:",results[0].length);
            // save the selected releases
            that.selectedR = selectedR; 
            that.mapSnapshots(results[0]);
        });
    },

    // maps the set of story snapshots for each feature
    mapSnapshots : function( features ) {
        var that = this;
        
        async.map(features, this.readFeatureSnapshots, function(err,results) {
            var snapshots = [];
            _.each( results, function(result) { 
                snapshots = snapshots.concat(result);
            });
            console.log("snapshots",snapshots.length);
            that.processSnapshots(snapshots);
        });

    },
    
    processSnapshots : function( snapshots ) {
        var that = this;
        var projects = _.uniq(_.pluck( snapshots, function(s) { return s.get("Project");}));
        console.log("projects",projects.length);
        
        // get the start and end date to chart.
        var start = _.min(that.selectedR, function(r) { return r.releaseStartDate;});
        //var end   = _.max(that.selectedR, function(r) { return r.releaseDate;});
        var date = new Date();

        var hcdata = createHighChartsData(snapshots,start.isoStart,date.toISOString(),that.projects);
        
        // mangle the hc data so we show projects on x-axis.
        var seriesData = hcdata.slice(1, hcdata.length);
        var series0 = {name: "label", data : _.map( seriesData, function(h) { return that.projectName(h.name.substring(7)); })};
        var series = [];
        _.each(hcdata[0].data, function(w) {
            i= _.indexOf(hcdata[0].data,w);
            series.push({
                name : w,
                data : _.map( seriesData, function(h){ return h.data[i]})
            });
        });
        
        console.log("series0",series0);
        console.log("series",series);
        
        console.log("hcdata",hcdata);
        // that._showChart(hcdata);
        that._showChart([series0].concat(series));
    },
    
    
     // read all stories for a specific feature.
    readFeatureSnapshots : function(feature,callback) {
        var that = this;

        Ext.create('Rally.data.lookback.SnapshotStore', {
            autoLoad : true,
            listeners: {
                scope : this,
                load: function(store, data, success) {
                    callback(null,data);
                }
            },
            fetch: ['Project', 'ScheduleState', 'PlanEstimate','Children','Iteration'],
            hydrate : ['ScheduleState'],
            filters: [
                {
                    property: '_TypeHierarchy',
                    operator: 'in',
                    value: ['HierarchicalRequirement']
                },
                {
                    property: '_ItemHierarchy',
                    operator: 'in',
                    value: [feature.get("ObjectID")]
                },
                {
                    property: 'Children',
                    operator: '=',
                    value: null
                }
            ]
        });
    },
    
    projectName : function(pid) {
        var project = _.find(this.projects,function(p) { return p.get("ObjectID") == pid; });
        return project ? project.get("Name") : null;
    },
    
    _showChart : function(series) {
        var that = this;
        var chart = this.down("#chart1");
        if (chart !== null)
            chart.destroy();
            
        var extChart = Ext.create('Rally.ui.chart.Chart', {
            columnWidth : 1,
            itemId : "chart1",
            chartData: {
                categories : series[0].data,
                series : series.slice(1, series.length)
            },
            chartColors: ['Gray', 'Orange', 'Green', 'LightGray', 'Blue','Green'],

            chartConfig : {
                chart: {
                    type: 'column'
                },
                title: {
                text: 'Team Release Completion Trend',
                x: -20 //center
                },
                plotOptions: {
                    series: {
                        marker: {
                            radius: 2
                        }
                    }
                },
                xAxis: {
                    //tickInterval : 7,
                    // tickInterval : tickInterval,
                    type: 'datetime',
                    labels: {
                        // formatter: function() {
                        //     return Highcharts.dateFormat('%b %d', Date.parse(this.value));
                        // }
                    }
                },
                yAxis: {
                    title: {
                        text: "Complete(%)"
                    },
                    plotLines: [{
                        value: 0,
                        width: 1,
                        color: '#808080'
                    }]
                },
                tooltip: {
                },
                legend: { align: 'center', verticalAlign: 'bottom' }
            }
        });
        this.add(extChart);
        chart = this.down("#chart1");
        var p = Ext.get(chart.id);
        elems = p.query("div.x-mask");
        _.each(elems, function(e) { e.remove(); });
        var elems = p.query("div.x-mask-msg");
        _.each(elems, function(e) { e.remove(); });
    }
    
});
