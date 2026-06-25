import { AsyncLocalStorage } from "node:async_hooks";
import type { Express } from "express";

const requestContext = new AsyncLocalStorage<{ method: string; path: string }>();
const GUARDED = Symbol.for("anchor.read-purity-guarded");
const SQL_GUARDED = Symbol.for("anchor.read-purity-sql-guarded");

const MUTATING_METHOD = /^(create|update|delete|replace|clear|log|link|unlink|upsert|mark|seed|reorder|refresh|sync)/i;
const MUTATING_SQL = /(?:^|;)\s*(?:insert|update|delete|replace|create|alter|drop|vacuum|reindex|attach|detach)\b/i;
const STATEMENT_EXECUTION_METHODS = new Set(["run", "get", "all", "iterate", "pluck", "raw", "expand"]);

export class ReadPurityViolation extends Error {
  status = 405;
  code = "read_purity_violation";

  constructor(operation: string, path: string) {
    super(`GET ${path} attempted the write operation ${operation}. Use an explicit command endpoint instead.`);
    this.name = "ReadPurityViolation";
  }
}

export function currentRequestContext() {
  return requestContext.getStore() || null;
}

export function runWithRequestMethod<T>(method: string, path: string, fn: () => T): T {
  return requestContext.run({ method: method.toUpperCase(), path }, fn);
}

export function assertMutationAllowed(operation: string) {
  const context = currentRequestContext();
  if (context?.method === "GET" || context?.method === "HEAD") {
    throw new ReadPurityViolation(operation, context.path);
  }
}

function guardStorageService(storageInstance: object) {
  const guarded = storageInstance as Record<PropertyKey, unknown>;
  if (guarded[GUARDED]) return;

  const prototype = Object.getPrototypeOf(storageInstance);
  for (const name of Object.getOwnPropertyNames(prototype)) {
    if (name === "constructor" || !MUTATING_METHOD.test(name)) continue;
    const original = (storageInstance as any)[name];
    if (typeof original !== "function") continue;

    Object.defineProperty(storageInstance, name, {
      configurable: true,
      enumerable: false,
      writable: true,
      value: function guardedStorageMutation(this: unknown, ...args: unknown[]) {
        assertMutationAllowed(`storage.${name}`);
        return original.apply(this, args);
      },
    });
  }

  Object.defineProperty(storageInstance, GUARDED, {
    configurable: false,
    enumerable: false,
    writable: false,
    value: true,
  });
}

function guardSqliteHandle(sqlite: any) {
  if (!sqlite || sqlite[SQL_GUARDED]) return;

  const originalPrepare = sqlite.prepare.bind(sqlite);
  sqlite.prepare = (sql: string) => {
    const statement = originalPrepare(sql);
    if (!MUTATING_SQL.test(String(sql || ""))) return statement;
    return new Proxy(statement, {
      get(target, property) {
        const value = Reflect.get(target, property, target);
        if (typeof value !== "function") return value;
        return (...args: unknown[]) => {
          if (STATEMENT_EXECUTION_METHODS.has(String(property))) {
            assertMutationAllowed(`SQL ${String(sql).trim().slice(0, 48)}`);
          }
          return value.apply(target, args);
        };
      },
    });
  };

  if (typeof sqlite.exec === "function") {
    const originalExec = sqlite.exec.bind(sqlite);
    sqlite.exec = (sql: string) => {
      if (MUTATING_SQL.test(String(sql || ""))) assertMutationAllowed(`SQL exec ${String(sql).trim().slice(0, 48)}`);
      return originalExec(sql);
    };
  }

  if (typeof sqlite.pragma === "function") {
    const originalPragma = sqlite.pragma.bind(sqlite);
    sqlite.pragma = (source: string, ...args: unknown[]) => {
      if (/=|wal_checkpoint|optimize|vacuum/i.test(String(source || ""))) {
        assertMutationAllowed(`PRAGMA ${String(source).trim().slice(0, 48)}`);
      }
      return originalPragma(source, ...args);
    };
  }

  Object.defineProperty(sqlite, SQL_GUARDED, {
    configurable: false,
    enumerable: false,
    writable: false,
    value: true,
  });
}

/**
 * Installs a fail-closed request boundary around both the storage service and
 * direct SQLite access. Known read endpoints still receive purpose-built pure
 * implementations; the guard protects future handlers from silent GET writes.
 */
export function installReadPurityGuard(app: Express, storageInstance: object, sqlite?: object) {
  app.use((req, _res, next) => {
    runWithRequestMethod(req.method, req.path, next);
  });
  guardStorageService(storageInstance);
  guardSqliteHandle(sqlite);
}
