var createHighChartsData = function ( snapshots, start, end,rallyProjects) {
        
        var lumenize = window.parent.Rally.data.lookback.Lumenize;
        console.log("lumenize",lumenize);
        var snapShotData = _.map(snapshots,function(d){return d.data;});
        console.log("snapShotData",snapShotData);
        var projects = _.uniq(_.pluck(snapShotData,function(s) { return s.Project; }) );
        // map project id's to project names
        // projects = _.map( projects, function(p) {
        //     var rallyProject = _.find( rallyProjects,  function(rp) { return p == rp.get("ObjectID");  });
        //     return rallyProject.get("Name");
        // });
        console.log("projects",projects);
        var myCalc = Ext.create("MyBurnCalculator");

        // can be used to 'knockout' holidays
        var holidays = [
            {year: 2014, month: 1, day: 1}  // Made up holiday to test knockout
        ];

        // calculator config
        var config = {
            deriveFieldsOnInput: myCalc.getDerivedFieldsOnInput(),
            metrics: myCalc.getMetrics(),
            summaryMetricsConfig: [],
            deriveFieldsAfterSummary: myCalc.getDerivedFieldsAfterSummary(),
            granularity: lumenize.Time.WEEK,
            tz: 'America/Chicago',
            holidays: holidays,
            workDays: 'Monday,Tuesday,Wednesday,Thursday,Friday,Saturday,Sunday'
        };
        
        config.deriveFieldsOnInput.push({
            as: 'Accepted', 
            f:  function(row) {
                return row.ScheduleState == "Accepted" ? row.PlanEstimate : 0;
            }
        });

        // add the metrics for each project        
        _.each(projects,function(project) {
            config.metrics.push(
                {
                      field: "PlanEstimate",
                      as: ""+project,
                      display: 'column',
                      f: 'filteredSum', 
                      filterField: 'Project', 
                      filterValues: [project]
                }
            );
            config.metrics.push(
                {
                      field: "Accepted",
                      as: "Accepted"+project,
                      display: 'column',
                      f: 'filteredSum', 
                      filterField: 'Project', 
                      filterValues: [project]
                }
            );
        });
        
        _.each(projects,function(project) {
            config.deriveFieldsAfterSummary.push({ 
                p : project,
                
                as: 'Percent'+project, 
                f: function (row, index, summaryMetrics, seriesData) {
                    // console.log("this.p",row[""+this.p], row["Accepted"+this.p]);
                    return row[""+this.p] > 0 ? (row["Accepted"+this.p] / row[""+this.p] * 100) : 0;
                }
            });
        });

        // create the calculator and add snapshots to it.
        var calculator = new lumenize.TimeSeriesCalculator(config);

        calculator.addSnapshots(snapShotData, start, end);
        
        // create a high charts series config object, used to get the hc series data
        var hcConfig = [{ name : "label" }];
        _.each(projects,function(project) {
            // hcConfig.push({ name : ""+project }) ;
            // hcConfig.push({ name : "Accepted"+project }) ;
            hcConfig.push({ name : "Percent"+project }) ;
        });
        var hc = lumenize.arrayOfMaps_To_HighChartsSeries(calculator.getResults().seriesData, hcConfig);
        return hc;
}