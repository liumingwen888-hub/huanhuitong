export type DatabaseGenerated<T> = {
  readonly __select__: T;
  readonly __insert__: T | undefined;
  readonly __update__: T;
};

export type DatabaseGeneratedImmutable<T> = {
  readonly __select__: T;
  readonly __insert__: T | undefined;
  readonly __update__: never;
};

export type DatabaseImmutable<T, Insert = T> = {
  readonly __select__: T;
  readonly __insert__: Insert;
  readonly __update__: never;
};

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export interface UsersTable {
  readonly uid: DatabaseGeneratedImmutable<string>;
  readonly status: 'ACTIVE' | 'RESTRICTED' | 'SUSPENDED' | 'CLOSED';
  readonly created_at: DatabaseGeneratedImmutable<Date>;
}

export interface MembershipsTable {
  readonly membership_id: DatabaseGeneratedImmutable<string>;
  readonly uid: DatabaseImmutable<string>;
  readonly status: 'ACTIVE' | 'SUSPENDED' | 'CLOSED';
  readonly created_at: DatabaseGeneratedImmutable<Date>;
}

export interface IdentityProfilesTable {
  readonly uid: DatabaseImmutable<string>;
  readonly username_snapshot: string | null;
  readonly display_name_snapshot: string | null;
  readonly updated_at: DatabaseGenerated<Date>;
}

export interface ChannelBindingsTable {
  readonly binding_id: DatabaseGeneratedImmutable<string>;
  readonly channel_type: DatabaseImmutable<'TELEGRAM'>;
  readonly external_user_id: DatabaseImmutable<string>;
  readonly uid: DatabaseImmutable<string>;
  readonly status: 'PENDING' | 'ACTIVE' | 'REVOKED' | 'CONFLICTED';
  readonly created_at: DatabaseGeneratedImmutable<Date>;
  readonly revoked_at: Date | null;
}

export interface RegistrationIdempotencyTable {
  readonly registration_key: DatabaseImmutable<string>;
  readonly channel_type: DatabaseImmutable<'TELEGRAM'>;
  readonly external_user_id: DatabaseImmutable<string>;
  readonly uid: string | null;
  readonly status: 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CONFLICT';
  readonly created_at: DatabaseGeneratedImmutable<Date>;
  readonly completed_at: Date | null;
  readonly failure_code: string | null;
  readonly failed_at: Date | null;
  readonly conflicted_at: Date | null;
}

export interface InboxMessagesTable {
  readonly inbox_id: DatabaseGeneratedImmutable<string>;
  readonly consumer: DatabaseImmutable<string>;
  readonly external_message_id: DatabaseImmutable<string>;
  readonly payload_digest: DatabaseImmutable<string>;
  readonly digest_key_version: DatabaseImmutable<string>;
  readonly correlation_id: DatabaseImmutable<string>;
  readonly status: 'RECEIVED' | 'CLAIMED' | 'PROCESSED' | 'CONFLICT' | 'FAILED';
  readonly received_at: DatabaseImmutable<Date>;
  readonly claimed_by: string | null;
  readonly claim_generation: DatabaseGenerated<number>;
  readonly claimed_until: Date | null;
  readonly processed_at: Date | null;
  readonly failure_code: string | null;
}

export interface OutboxMessagesTable {
  readonly outbox_id: DatabaseImmutable<string>;
  readonly topic: DatabaseImmutable<string>;
  readonly event_key: DatabaseImmutable<string>;
  readonly version: DatabaseImmutable<1>;
  readonly payload: DatabaseImmutable<JsonValue>;
  readonly correlation_id: DatabaseImmutable<string>;
  readonly status:
    | 'READY'
    | 'LEASED'
    | 'SUCCEEDED'
    | 'RETRY_WAIT'
    | 'DEAD_LETTER'
    | 'PAUSED'
    | 'WAITING_CONFIGURATION';
  readonly attempt_count: DatabaseGenerated<number>;
  readonly available_at: Date;
  readonly locked_by: string | null;
  readonly lock_generation: DatabaseGenerated<number>;
  readonly lease_token: string | null;
  readonly locked_until: Date | null;
  readonly created_at: DatabaseGeneratedImmutable<Date>;
  readonly succeeded_at: Date | null;
}

export interface DurableJobsTable {
  readonly job_id: DatabaseGeneratedImmutable<string>;
  readonly job_type: DatabaseImmutable<string>;
  readonly business_key: DatabaseImmutable<string>;
  readonly payload: DatabaseImmutable<JsonValue>;
  readonly status:
    | 'READY'
    | 'LEASED'
    | 'SUCCEEDED'
    | 'RETRY_WAIT'
    | 'DEAD_LETTER'
    | 'PAUSED'
    | 'WAITING_CONFIGURATION';
  readonly attempt_count: DatabaseGenerated<number>;
  readonly available_at: Date;
  readonly locked_by: string | null;
  readonly lock_generation: DatabaseGenerated<number>;
  readonly lease_token: string | null;
  readonly locked_until: Date | null;
  readonly created_at: DatabaseGeneratedImmutable<Date>;
  readonly succeeded_at: Date | null;
}

export interface AuditEventsTable {
  readonly audit_event_id: DatabaseGeneratedImmutable<string>;
  readonly event_type: DatabaseImmutable<string>;
  readonly actor_type: DatabaseImmutable<string>;
  readonly actor_ref: DatabaseImmutable<string>;
  readonly subject_ref: DatabaseImmutable<string>;
  readonly outcome: DatabaseImmutable<string>;
  readonly correlation_id: DatabaseImmutable<string>;
  readonly occurred_at: DatabaseImmutable<Date>;
}

export interface StageOneDatabase {
  readonly users: UsersTable;
  readonly memberships: MembershipsTable;
  readonly identity_profiles: IdentityProfilesTable;
  readonly channel_bindings: ChannelBindingsTable;
  readonly registration_idempotency: RegistrationIdempotencyTable;
  readonly inbox_messages: InboxMessagesTable;
  readonly outbox_messages: OutboxMessagesTable;
  readonly durable_jobs: DurableJobsTable;
  readonly audit_events: AuditEventsTable;
}
