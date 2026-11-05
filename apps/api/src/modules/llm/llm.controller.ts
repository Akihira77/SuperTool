import { BadRequestException, Body, Controller, Get, Post, Query } from '@nestjs/common';
import { cfg } from '../../config';

const SYSTEM_PROMPT = [
  'Kamu asisten konfigurasi nginx dan Linux untuk developer.',
  'Jelaskan dengan bahasa Indonesia yang ringkas dan teknis.',
  'Format jawaban: 1) fungsi potongan tersebut, 2) efeknya kalau diubah/dihapus,',
  '3) jebakan umum. Maksimal 8 baris. Tanpa basa-basi.',
].join(' ');

function baseUrl(): string {
  return cfg.llm.baseUrl.replace(/\/+$/, '');
}

async function callLlm(path: string, init?: RequestInit, apiKey?: string): Promise<unknown> {
  const key = (apiKey ?? '').trim() || cfg.llm.apiKey;
  let response: Response;
  try {
    response = await fetch(baseUrl() + path, {
      ...init,
      signal: AbortSignal.timeout(60_000),
      headers: {
        'content-type': 'application/json',
        ...(key ? { authorization: 'Bearer ' + key } : {}),
        ...(init?.headers as Record<string, string> | undefined),
      },
    });
  } catch (err) {
    throw new BadRequestException('LLM tidak bisa dihubungi (' + baseUrl() + '): ' + (err as Error).message);
  }
  const text = await response.text();
  if (!response.ok) {
    throw new BadRequestException('LLM membalas ' + response.status + ': ' + text.slice(0, 300));
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new BadRequestException('Balasan LLM bukan JSON: ' + text.slice(0, 200));
  }
}

@Controller('llm')
export class LlmController {
  @Get('models')
  async models(@Query('key') key?: string) {
    try {
      const data = (await callLlm('/models', undefined, key)) as { data?: Array<{ id: string }> };
      const models = (data.data ?? []).map((item) => item.id).filter(Boolean);
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
    const data = (await callLlm('/chat/completions', {
      method: 'POST',
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: question + '\n\n' + '~~~\n' + code + '\n~~~' },
        ],
      }),
    }, body?.apiKey)) as { choices?: Array<{ message?: { content?: string } }> };

    const answer = data.choices?.[0]?.message?.content;
    if (!answer) throw new BadRequestException('Balasan LLM kosong');
    return { text: answer, model };
  }
}
