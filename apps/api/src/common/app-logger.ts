import { ConsoleLogger, type LoggerService } from '@nestjs/common';
import { inspect } from 'node:util';
import { pushLog, type LogLevel } from './log-buffer';

function text(message: unknown, params: unknown[]): string {
  return [message, ...params]
    .map((value) => (typeof value === 'string' ? value : inspect(value, { depth: 2, breakLength: Infinity })))
    .join(' ');
}

function contextOf(params: unknown[]): string {
  const last = params[params.length - 1];
  return typeof last === 'string' ? last : '';
}

/** Mencatat log Nest ke ring buffer sekaligus meneruskannya ke konsol. */
export class AppLogger implements LoggerService {
  private readonly inner = new ConsoleLogger();

  log(message: unknown, ...optionalParams: unknown[]): void {
    this.record('log', message, optionalParams);
    this.inner.log(message, ...optionalParams);
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    this.record('warn', message, optionalParams);
    this.inner.warn(message, ...optionalParams);
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    this.record('error', message, optionalParams);
    this.inner.error(message, ...optionalParams);
  }

  debug(message: unknown, ...optionalParams: unknown[]): void {
    this.record('debug', message, optionalParams);
    this.inner.debug(message, ...optionalParams);
  }

  verbose(message: unknown, ...optionalParams: unknown[]): void {
    this.record('verbose', message, optionalParams);
    this.inner.verbose(message, ...optionalParams);
  }

  private record(level: LogLevel, message: unknown, params: unknown[]): void {
    pushLog(level, text(message, params), contextOf(params));
  }
}
