import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { AuditService } from '../modules/audit/audit.service';

const FEATURE_ALIASES: Record<string, string> = {
  hook: 'webhook',
  restore: 'backup',
};

function featureFor(path: string): string {
  const first = path.replace(/^\/api\/?/, '').split('/')[0] ?? '';
  return FEATURE_ALIASES[first] ?? (first || 'root');
}

function safePath(path: string): string {
  // Token webhook adalah kredensial: jangan disimpan di kolom path.
  return path.replace(/^\/api\/hook\/[^/]+/, '/api/hook/:token');
}

function fileMeta(req: Request & { file?: { fieldname?: string; originalname?: string; mimetype?: string; size?: number } }): unknown {
  if (!req.file) return undefined;
  return {
    field: req.file.fieldname,
    filename: req.file.originalname,
    mime: req.file.mimetype,
    size: req.file.size,
  };
}

export function auditHttp(service: AuditService): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Request baca (GET/HEAD/OPTIONS) tidak mengubah state dan hanya membuat
    // audit penuh noise; abaikan. Mutasi tetap dicatat sampai response selesai.
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
      next();
      return;
    }

    const started = Date.now();
    let logged = false;

    const write = (): void => {
      if (logged) return;
      logged = true;

      const original = req.originalUrl || req.url || '';
      const path = safePath(original.split('?')[0] || '');
      const query = req.query && Object.keys(req.query).length ? req.query : undefined;
      const params = req.params && Object.keys(req.params).length ? req.params : undefined;
      const body = (req as Request & { body?: unknown }).body;
      const file = fileMeta(req as Request & { file?: { fieldname?: string; originalname?: string; mimetype?: string; size?: number } });
      const payload: Record<string, unknown> = {};
      if (query) payload.query = query;
      if (params) payload.params = params;
      if (body !== undefined) payload.body = body;
      if (file) payload.file = file;

      service.record({
        source: 'web',
        actor: 'web',
        feature: featureFor(path),
        action: req.method + ' ' + path,
        method: req.method,
        path,
        status: res.statusCode,
        durationMs: Date.now() - started,
        ip: req.ip ?? null,
        userAgent: req.get('user-agent') ?? null,
        payload,
        error: null,
      });
    };

    res.once('finish', write);
    res.once('close', write);
    next();
  };
}
