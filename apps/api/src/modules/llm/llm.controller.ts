import { BadRequestException, Body, Controller, Get, Post, Query } from '@nestjs/common';
import { cfg } from '../../config';

const SYSTEM_PROMPT = [
  'Kamu asisten konfigurasi nginx dan Linux untuk developer.',
  'Jelaskan dengan bahasa Indonesia yang ringkas dan teknis.',
  'Format jawaban: 1) fungsi potongan tersebut, 2) efeknya kalau diubah/dihapus,',
  '3) jebakan umum. Maksimal 8 baris. Tanpa basa-basi.',
].join(' ');

type Chunk = {
  choices?: Array<{ message?: { content?: string }; delta?: { content?: string }; text?: string }>;
};

function baseUrl(): string {
  return cfg.llm.baseUrl.replace(/\/+$/, '');
}

/** Ambil semua objek JSON utuh dari teks (menangani SSE, NDJSON, atau satu objek). */
function jsonObjects(text: string): Chunk[] {
  const found: Chunk[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{') {
      if (depth === 0) start = i;
      depth += 1;
      continue;
    }
    if (char === '}') {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        const raw = text.slice(start, i + 1);
        try {
          found.push(JSON.parse(raw) as Chunk);
        } catch {
          // lewati potongan yang rusak
        }
        start = -1;
      }
      if (depth < 0) depth = 0;
    }
  }
  return found;
}

function answerFrom(text: string): string {
  const parts: string[] = [];
  for (const chunk of jsonObjects(text)) {
    const choice = chunk.choices?.[0];
    const piece = choice?.message?.content ?? choice?.delta?.content ?? choice?.text;
    if (piece) parts.push(piece);
  }
  return parts.join('').trim();
}

async function callLlm(path: string, init?: RequestInit, apiKey?: string): Promise<Response> {
  const key = (apiKey ?? '').trim() || cfg.llm.apiKey;
  try {
    return await fetch(baseUrl() + path, {
      ...init,
      signal: AbortSignal.timeout(120_000),
      headers: {
        'content-type': 'application/json',
        ...(key ? { authorization: 'Bearer ' + key } : {}),
        ...(init?.headers as Record<string, string> | undefined),
      },
    });
  } catch (err) {
    throw new BadRequestException('LLM tidak bisa dihubungi (' + baseUrl() + '): ' + (err as Error).message);
  }
}

@Controller('llm')
export class LlmController {
  @Get('models')
  async models(@Query('key') key?: string) {
    try {
      const response = await callLlm('/models', undefined, key);
      const text = await response.text();
      if (!response.ok) throw new Error('LLM membalas ' + response.status + ': ' + text.slice(0, 200));
      const data = JSON.parse(text) as { data?: Array<{ id: string }>; models?: Array<{ id?: string; name?: string }> };
      const models = [...(data.data ?? []), ...(data.models ?? [])]
        .map((item) => (item as any).id ?? (item as any).name)
        .filter((id): id is string => Boolean(id));
      return { ok: true, baseUrl: baseUrl(), models };
    } catch (err) {
      return { ok: false, baseUrl: baseUrl(), models: [] as string[], error: (err as Error).message };
    }
  }

  @Post('explain')
  async explain(@Body() body: { code?: string; model?: string; question?: string; apiKey?: string }) {
    const code = String(body?.code ?? '').slice(0, 20_000).trim();
    if (!code) throw new BadRequestException('Tidak ada teks yang dipilih');
    const model = String(body?.model ?? cfg.llm.model ?? '').trim();
    if (!model) throw new BadRequestException('Model LLM belum dipilih');

    const question = String(body?.question ?? '').trim() || 'Jelaskan bagian konfigurasi ini.';
    const response = await callLlm(
      '/chat/completions',
      {
        method: 'POST',
        body: JSON.stringify({
          model,
          stream: false,
          temperature: 0.2,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: question + '\n\n' + '~~~\n' + code + '\n~~~' },
          ],
        }),
      },
      body?.apiKey,
    );

    const text = await response.text();
    if (!response.ok) throw new BadRequestException('LLM membalas ' + response.status + ': ' + text.slice(0, 300));

    const answer = answerFrom(text);
    if (!answer) {
      const type = response.headers.get('content-type') ?? '?';
      throw new BadRequestException('Balasan LLM tidak berisi teks (' + type + '): ' + text.slice(0, 200));
    }
    return { text: answer, model };
  }
}
