import elasticsearch from 'elasticsearch';
import expect from 'expect.js';
import _ from 'lodash';
import sinon from 'sinon';
import requirefrom from 'requirefrom';
const fromRoot = requirefrom('src/utils')('fromRoot');
const packageJson = require(fromRoot('package.json'));
const wrapAsync = requirefrom('src/testUtils')('wrap_async');
const indexSnapshot = requirefrom('src/testUtils')('index_snapshot');

const ScenarioManager = requirefrom('src/testUtils')('scenario_manager');
import Migration from '../../migration_5';
import Scenario1 from './scenarios/migration_5/scenario1';
import Scenario2 from './scenarios/migration_5/scenario2';
import Scenario3 from './scenarios/migration_5/scenario3';
import Scenario4 from './scenarios/migration_5/scenario4';
import Scenario5 from './scenarios/migration_5/scenario5';

const serverConfig = requirefrom('test')('serverConfig');
import url from 'url';

describe('kibi_core/migrations/functional', function () {

  let clusterUrl =  url.format(serverConfig.servers.elasticsearch);
  let timeout = 60000;
  this.timeout(timeout);

  let scenarioManager = new ScenarioManager(clusterUrl, timeout);
  let client = new elasticsearch.Client({
    host: clusterUrl,
    requestTimeout: timeout
  });

  async function snapshot() {
    return indexSnapshot(client, '.kibi');
  }

  describe('Migration 5 - Functional test', function () {
    let warningSpy;
    let configuration;

    describe('should not update anything', function () {

      beforeEach(wrapAsync(async () => {
        await scenarioManager.reload(Scenario5);
      }));

      afterEach(wrapAsync(async () => {
        await scenarioManager.unload(Scenario5);
      }));

      beforeEach(() => {
        configuration = {
          index: '.kibi',
          client: client,
          logger: {
            warning: sinon.spy(),
            info: sinon.spy()
          }
        };
        warningSpy = configuration.logger.warning;
      });

      it('should count all upgradeable objects', wrapAsync(async () => {
        let migration = new Migration(configuration);
        let result = await migration.count();
        expect(result).to.be(0);
      }));

    });

    _.each([
      {
        label: 'Scenario1',
        Scenario: Scenario1,
        expectedNewRelations: 0
      },
      {
        label: 'Scenario2',
        Scenario: Scenario2,
        expectedNewRelations: 0
      },
      {
        label: 'Scenario3',
        Scenario: Scenario3,
        expectedNewRelations: 1
      },
      {
        label: 'Scenario4',
        Scenario: Scenario4,
        expectedNewRelations: 3
      }
    ], ({ label, Scenario, expectedNewRelations }) => {
      describe(`should update the kibi sequential filter - ${label}`, function () {

        beforeEach(wrapAsync(async () => {
          await scenarioManager.reload(Scenario);
        }));

        afterEach(wrapAsync(async () => {
          await scenarioManager.unload(Scenario);
        }));

        beforeEach(() => {
          configuration = {
            index: '.kibi',
            client: client,
            logger: {
              warning: sinon.spy(),
              info: sinon.spy()
            }
          };
          warningSpy = configuration.logger.warning;
        });

        it('should count all upgradeable objects', wrapAsync(async () => {
          let migration = new Migration(configuration);
          let result = await migration.count();
          expect(result).to.be(1);
        }));

        it('should upgrade all upgradeable objects', wrapAsync(async () => {
          let before = await snapshot();
          let migration = new Migration(configuration);

          let result = await migration.upgrade();
          expect(result).to.be(1);

          let after = await snapshot();
          expect(before.size).to.equal(after.size);

          // get the relations
          const originalRelations = JSON.parse(before.get(packageJson.kibi_version)._source['kibi:relations']);
          const upgradedRelations = JSON.parse(after.get(packageJson.kibi_version)._source['kibi:relations']);

          const original = before.get('buttons');
          const upgraded = after.get('buttons');
          const originalVisState = JSON.parse(original._source.visState);
          const upgradedVisState = JSON.parse(upgraded._source.visState);

          expect(upgradedVisState).not.to.be.an('undefined');

          let actualNewRelations = 0;

          const SEPARATOR = '/';
          expect(upgradedVisState.params.buttons.length).to.be(originalVisState.params.buttons.length);
          for (let i = 0; i < originalVisState.params.buttons.length; i++) {
            const originalButton = originalVisState.params.buttons[i];
            const upgradedButton = upgradedVisState.params.buttons[i];

            expect(upgradedButton.filterLabel).to.be(originalButton.filterLabel);
            expect(upgradedButton.label).to.be(originalButton.label);
            expect(upgradedButton.targetDashboardId).to.be(originalButton.redirectToDashboard);
            expect(upgradedButton.sourceDashboardId).to.not.be.ok();

            const mapping = await client.indices.getMapping({
              index: [
                originalButton.sourceIndexPatternId,
                originalButton.targetIndexPatternId
              ]
            });
            const sourceTypes = _.keys(mapping[originalButton.sourceIndexPatternId].mappings);
            const targetTypes = _.keys(mapping[originalButton.targetIndexPatternId].mappings);
            const [ leftIndex, leftType, leftPath, rightIndex, rightType, rightPath ] = upgradedButton.indexRelationId.split(SEPARATOR);
            let left = [
              originalButton.sourceIndexPatternId,
              originalButton.sourceIndexPatternType,
              originalButton.sourceField
            ];
            let right = [
              originalButton.targetIndexPatternId,
              originalButton.targetIndexPatternType,
              originalButton.targetField
            ];
            if (left.join(SEPARATOR) > right.join(SEPARATOR)) {
              const tmp = left;
              left = right;
              right = tmp;
            }
            expect(leftIndex).to.be(left[0]);
            expect(leftPath).to.be(left[2]);
            expect(rightIndex).to.be(right[0]);
            expect(rightPath).to.be(right[2]);
            // only check the types if an index has more than one
            if (sourceTypes.length > 1 || targetTypes.length > 1) {
              expect(rightType).to.be(right[1]);
              expect(leftType).to.be(left[1]);
            }

            const relation = _.find(upgradedRelations.relationsIndices, 'id', upgradedButton.indexRelationId);
            expect(relation).to.be.ok();
            if (!_.find(originalRelations.relationsIndices, 'id', upgradedButton.indexRelationId)) {
              actualNewRelations++;
            }
          };

          expect(actualNewRelations).to.be(expectedNewRelations);

          expect(upgradedVisState.version).to.equal(2);

          expect(warningSpy.called).to.be(false);

          result = await migration.count();
          expect(result).to.be(0);
        }));
      });
    });
  });

});
