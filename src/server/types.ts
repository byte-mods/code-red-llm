/**
 * Minimal local typings for the slice of the Node-RED runtime API we touch.
 *
 * Node-RED ships @types/node-red, but its surface is huge and partly
 * inaccurate for plugin authors. We narrow to exactly the members we use so
 * downstream code stays honest about its dependencies and `any` does not leak
 * into call sites.
 *
 * If a future task needs more of the API surface, extend this file — do not
 * reach for `any`.
 */
import type { Express, Request, Response, NextFunction } from 'express';

/**
 * Logger shape Node-RED exposes at `RED.log`. Severity is informational; all
 * methods accept any printable value.
 */
export interface RedLog {
  info(msg: unknown): void;
  warn(msg: unknown): void;
  error(msg: unknown): void;
  debug(msg: unknown): void;
  trace(msg: unknown): void;
}

/**
 * Descriptor passed to `RED.plugins.registerPlugin`. The `type` field is the
 * canonical plugin category — Node-RED uses it to namespace lookup. Our plugin
 * is a host for sidebar UI + admin routes, hence `node-red-plugin`.
 */
export interface PluginDescriptor {
  type: string;
  onadd?: () => void;
  onremove?: () => void;
}

/**
 * The `plugins` namespace on RED — we only call `registerPlugin`.
 */
export interface RedPlugins {
  registerPlugin(id: string, descriptor: PluginDescriptor): void;
}

/**
 * Slice of `RED.nodes` we need for the hot-reload path. Mirrors the
 * NodesNamespace shape in src/server/nodes/red-runtime.ts so both files
 * can refer to the same underlying Node-RED API without one importing
 * the other.
 */
export interface RedNodes {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  registerType(type: string, ctor: any): void;
  createNode(node: any, config: Record<string, unknown>): void;
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

/**
 * The Node-RED runtime object passed to every plugin/node module. Only the
 * members we read are typed; everything else is intentionally absent so that
 * accidental dependencies on undocumented behavior show up as TS errors.
 */
export interface RED {
  log: RedLog;
  plugins: RedPlugins;
  /** Node-RED's type registry — used by node modules and the hot-reload path. */
  nodes: RedNodes;
  /** Express app mounted at the admin path; shares editor auth. */
  httpAdmin: Express;
  /** Settings object — read-only here. */
  settings: Record<string, unknown>;
  /**
   * Express-style body parser is wired by Node-RED on httpAdmin by
   * default, so POST handlers see JSON in `req.body`. The type lives
   * on Express's Request — no additional surface needed here.
   */
}

/**
 * The plugin module's default export — Node-RED requires this exact shape.
 */
export type PluginFactory = (red: RED) => void;

// Re-export for handler signatures that don't want to import express directly.
export type { Request, Response, NextFunction };
