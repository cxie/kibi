describe('AggConfig Filters', function () {
  describe('date_histogram', function () {
    let _ = require('lodash');
    let moment = require('moment');
    let sinon = require('auto-release-sinon');
    let aggResp = require('fixtures/agg_resp/date_histogram');
    let ngMock = require('ngMock');
    let expect = require('expect.js');

    let vis;
    let agg;
    let field;
    let filter;
    let bucketKey;
    let bucketStart;
    let getIntervalStub;
    let intervalOptions;

    let init;

    beforeEach(ngMock.module('kibana', function ($provide) {
      $provide.constant('kbnDefaultAppId', '');
      $provide.constant('kibiDefaultDashboardId', '');
      $provide.constant('elasticsearchPlugins', ['siren-join']);
    }));
    beforeEach(ngMock.inject(function (Private, $injector) {
      let Vis = Private(require('ui/Vis'));
      let indexPattern = Private(require('fixtures/stubbed_logstash_index_pattern'));
      let createFilter = Private(require('ui/agg_types/buckets/create_filter/date_histogram'));
      let TimeBuckets = Private(require('ui/time_buckets'));
      intervalOptions = Private(require('ui/agg_types/buckets/_interval_options'));

      init = function (interval, duration) {
        interval = interval || 'auto';
        if (interval === 'custom') interval = agg.params.customInterval;
        duration = duration || moment.duration(15, 'minutes');
        field = _.sample(indexPattern.fields.byType.date);
        vis = new Vis(indexPattern, {
          type: 'histogram',
          aggs: [
            {
              type: 'date_histogram',
              schema: 'segment',
              params: { field: field.name, interval: interval, customInterval: '5d' }
            }
          ]
        });

        agg = vis.aggs[0];
        bucketKey = _.sample(aggResp.aggregations['1'].buckets).key;
        bucketStart = moment(bucketKey);

        let timePad = moment.duration(duration / 2);
        agg.buckets.setBounds({
          min: bucketStart.clone().subtract(timePad),
          max: bucketStart.clone().add(timePad),
        });
        agg.buckets.setInterval(interval);

        filter = createFilter(agg, bucketKey);
      };
    }));

    it('creates a valid range filter', function () {
      init();

      expect(filter).to.have.property('range');
      expect(filter.range).to.have.property(field.name);

      let fieldParams = filter.range[field.name];
      expect(fieldParams).to.have.property('gte');
      expect(fieldParams.gte).to.be.a('number');

      expect(fieldParams).to.have.property('lte');
      expect(fieldParams.lte).to.be.a('number');

      expect(fieldParams.gte).to.be.lessThan(fieldParams.lte);

      expect(filter).to.have.property('meta');
      expect(filter.meta).to.have.property('index', vis.indexPattern.id);
    });


    it('extends the filter edge to 1ms before the next bucket for all interval options', function () {
      intervalOptions.forEach(function (option) {
        let duration;
        if (option.val !== 'custom' && moment(1, option.val).isValid()) {
          duration = moment.duration(10, option.val);

          if (+duration < 10) {
            throw new Error('unable to create interval for ' + option.val);
          }
        }

        init(option.val, duration);

        let interval = agg.buckets.getInterval();
        let params = filter.range[field.name];

        expect(params.gte).to.be(+bucketStart);
        expect(params.lte).to.be(+bucketStart.clone().add(interval).subtract(1, 'ms'));
      });
    });
  });
});
