/**
 * Minimal ambient declaration for `oracledb`. The package ships .js
 * without types; rather than `npm i --save-dev @types/oracledb` (which
 * does not exist on the registry), we hand-author the slice we use.
 *
 * Extend if/when more API surface is needed.
 */
declare module 'oracledb' {
  export const OUT_FORMAT_OBJECT: number;

  export interface ExecuteOptions {
    outFormat?: number;
  }

  export interface Metadata {
    name: string;
  }

  export interface ExecuteResult<T = unknown> {
    rows?: T[];
    metaData?: Metadata[];
    rowsAffected?: number;
  }

  export interface Connection {
    execute<T = unknown>(
      sql: string,
      params?: unknown,
      options?: ExecuteOptions,
    ): Promise<ExecuteResult<T>>;
    close(): Promise<void>;
  }

  export interface PoolAttributes {
    connectString: string;
    user: string;
    password: string;
    poolMin?: number;
    poolMax?: number;
  }

  export interface Pool {
    getConnection(): Promise<Connection>;
    close(drainTime?: number): Promise<void>;
  }

  export function createPool(attrs: PoolAttributes): Promise<Pool>;

  const _default: {
    OUT_FORMAT_OBJECT: number;
    createPool(attrs: PoolAttributes): Promise<Pool>;
  };
  export default _default;
}
