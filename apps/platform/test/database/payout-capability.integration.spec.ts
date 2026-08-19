import { resolve } from 'node:path';
import { Pool } from 'pg';
import type { StageOneDatabase } from '@xht/contracts';
import {
  migrateAndValidate,
  startPostgresFixture,
  type PostgresFixture
} from '@xht/testing';
import { Kysely, PostgresDialect } from 'kysely';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it
} from 'vitest';
import { RoleEnforcingPostgresPool } from '../../src/infrastructure/database/database.js';
import {
  createUnitOfWork,
  type UnitOfWork
} from '../../src/infrastructure/database/unit-of-work.js';
import {
  PostgresProviderConfigRepository
} from '../../src/modules/fiatpayout/infrastructure/postgres-payout.repository.js';
import {
  PayoutCapabilityService
} from '../../src/modules/fiatpayout/application/payout-capability.service.js';

const projectRoot = resolve(import.meta.dirname, '../../../..');

let fixture: PostgresFixture;
let platformPool: Pool;
let cleanupPool: Pool;
let unitOfWork: UnitOfWork;
const configs = new PostgresProviderConfigRepository();
let capabilityService: PayoutCapabilityService;

beforeAll(async () => {
  fixture = await startPostgresFixture({
    projectRoot, startupTimeoutMillis: 120_000, stopTimeoutMillis: 10_000
  });
  const evidence = await migrateAndValidate(fixture, {
    projectRoot, configFile: 'database/flyway.toml',
    migrationsDirectory: 'database/migrations',
    callbacksDirectory: 'database/flyway-callbacks'
  });
  expect(evidence.firstMigrate.appliedVersions).toEqual(
    expect.arrayContaining([
      '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'
    ])
  );
  cleanupPool = new Pool({
    connectionString: fixture.bootstrapLogin.connectionString,
    max: 1, application_name: 'xht-s82-cleanup'
  });
  platformPool = new Pool({
    connectionString: fixture.platformLogin.connectionString,
    max: 4, application_name: 'xht-s82-platform'
  });
  const kysely = new Kysely<StageOneDatabase>({
    dialect: new PostgresDialect({
      pool: new RoleEnforcingPostgresPool(
        platformPool as never, fixture.platformLogin.username
      )
    })
  });
  unitOfWork = createUnitOfWork(kysely);
}, 180_000);

beforeEach(async () => {
  await cleanupPool.query(
    `DELETE FROM provider_configs WHERE provider_id <> 'fake-bank-v1'
        OR config_version > 1`
  );
  capabilityService = new PayoutCapabilityService(unitOfWork, configs);
});

afterAll(async () => {
  await platformPool.end();
  await cleanupPool.end();
  await fixture.stop();
}, 180_000);

describe.sequential('S8-2 payout capability and quote', () => {
  it('S8PC01: capabilities surface config facts and follow versions', async () => {
    const capabilities = await capabilityService.getCapabilities();
    expect(capabilities).toHaveLength(1);
    expect(capabilities[0]).toMatchObject({
      providerId: 'fake-bank-v1',
      configVersion: 1,
      route: 'US:USD',
      sourceAssetCode: 'USDT-TRC20',
      fixedFee: '2000',
      minAmount: '100000',
      maxAmount: '100000000'
    });
    await unitOfWork.execute((c) =>
      configs.insert(c, {
        providerId: 'fake-bank-v1',
        configVersion: 2,
        providerName: 'Fake Bank',
        route: 'US:USD',
        sourceAssetCode: 'USDT-TRC20',
        fixedFee: '2500',
        minAmount: '200000',
        maxAmount: '50000000',
        callbackSecretRef: 'vault:fake-bank-callback-v2'
      })
    );
    const updated = await capabilityService.getCapabilities();
    expect(updated[0]).toMatchObject({
      configVersion: 2,
      fixedFee: '2500'
    });
  });

  it('S8PC02: quotes compute fee and estimate exactly', async () => {
    const result = await capabilityService.quotePayout({
      route: 'US:USD',
      sourceAmount: '5000000'
    });
    expect(result.outcome).toBe('QUOTED');
    const quote = (result as { quote: Record<string, unknown> }).quote;
    expect(quote.fee).toBe('2000');
    expect(quote.estimatedFiat).toBe('4998000');
    expect(quote.estimate).toBe(true);
    expect(quote.providerId).toBe('fake-bank-v1');
  });

  it('S8PC03: amounts outside limits or below the fee are rejected', async () => {
    const tooSmall = await capabilityService.quotePayout({
      route: 'US:USD', sourceAmount: '99999'
    });
    expect(tooSmall).toEqual({
      outcome: 'REJECTED', reasonCode: 'PAYOUT_AMOUNT_OUT_OF_RANGE'
    });
    const tooLarge = await capabilityService.quotePayout({
      route: 'US:USD', sourceAmount: '100000001'
    });
    expect(tooLarge).toEqual({
      outcome: 'REJECTED', reasonCode: 'PAYOUT_AMOUNT_OUT_OF_RANGE'
    });
    const belowFee = await capabilityService.quotePayout({
      route: 'US:USD', sourceAmount: '2000'
    });
    expect(belowFee).toEqual({
      outcome: 'REJECTED', reasonCode: 'PAYOUT_AMOUNT_OUT_OF_RANGE'
    });
    const malformed = await capabilityService.quotePayout({
      route: 'us:usd', sourceAmount: '1000'
    });
    expect(malformed).toEqual({
      outcome: 'REJECTED', reasonCode: 'PAYOUT_COMMAND_INVALID'
    });
  });

  it('S8PC04: unknown routes fail closed', async () => {
    const unknown = await capabilityService.quotePayout({
      route: 'XX:XXX', sourceAmount: '500000'
    });
    expect(unknown).toEqual({
      outcome: 'REJECTED',
      reasonCode: 'PAYOUT_PROVIDER_CONFIG_NOT_FOUND'
    });
  });

  it('S8PC05: the newest config version wins per route', async () => {
    await unitOfWork.execute((c) =>
      configs.insert(c, {
        providerId: 'other-bank-v1',
        configVersion: 1,
        providerName: 'Other Bank',
        route: 'US:USD',
        sourceAssetCode: 'USDT-TRC20',
        fixedFee: '1500',
        minAmount: '100000',
        maxAmount: '100000000',
        callbackSecretRef: 'vault:other-callback-v1'
      })
    );
    const bothV1 = await capabilityService.quotePayout({
      route: 'US:USD', sourceAmount: '5000000'
    });
    expect((bothV1 as { quote: { fee: string } }).quote.fee)
      .toBe('2000');
    await unitOfWork.execute((c) =>
      configs.insert(c, {
        providerId: 'fake-bank-v1',
        configVersion: 3,
        providerName: 'Fake Bank',
        route: 'US:USD',
        sourceAssetCode: 'USDT-TRC20',
        fixedFee: '9999',
        minAmount: '100000',
        maxAmount: '100000000',
        callbackSecretRef: 'vault:fake-bank-callback-v3'
      })
    );
    const afterV3 = await capabilityService.quotePayout({
      route: 'US:USD', sourceAmount: '5000000'
    });
    expect((afterV3 as { quote: { fee: string; configVersion: number } })
      .quote.fee).toBe('9999');
    expect((afterV3 as { quote: { configVersion: number } }).quote
      .configVersion).toBe(3);
    const capabilities = await capabilityService.getCapabilities();
    expect(capabilities).toHaveLength(2);
  });
});
