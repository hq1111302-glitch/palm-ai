// api/analyze.js
// Vercel Serverless Function — securely proxies Gemini API requests

export const config = {
  maxDuration: 60, // Allow up to 60 seconds (for retries on 429)
};

export default async function handler(req, res) {
  // --- Security: Domain Validation ---
  const origin = req.headers.origin || req.headers.referer || '';

  // Allow local development and any vercel.app deployment for this project
  const isAllowed =
    origin.startsWith('http://localhost:') ||
    origin.startsWith('http://127.0.0.1:') ||
    origin.endsWith('.vercel.app');

  if (!isAllowed) {
    return res.status(403).json({ error: '허용되지 않은 도메인에서의 접근입니다.' });
  }

  // CORS headers - dynamically set to the allowed origin
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = req.body || {};
    const { imageB64, mimeType } = body;

    if (!imageB64 || typeof imageB64 !== 'string') {
      return res.status(400).json({ error: '이미지 데이터가 없습니다.' });
    }
    // Guard against extremely large payloads (should already be compressed client-side)
    if (imageB64.length > 4_000_000) {
      return res.status(413).json({ error: '이미지가 너무 큽니다. 더 작은 이미지를 사용해 주세요.' });
    }

    const safeMime = typeof mimeType === 'string' && mimeType.startsWith('image/')
      ? mimeType
      : 'image/jpeg';

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'GEMINI_API_KEY 환경 변수가 설정되지 않았습니다.' });
    }

    const model = 'gemini-2.0-flash';

    const prompt = `당신은 30년 경력의 신비로운 손금 전문가 '코스믹 마스터'입니다.
제공된 손바닥 사진을 보고 운명을 분석해 주세요.

반드시 아래 JSON 형식으로만 응답하세요. 마크다운 코드블록이나 다른 텍스트 없이 순수 JSON만 반환하세요.
{
  "overall_title": "분석을 요약하는 짧고 멋진 제목 (15자 이내)",
  "stars": 4,
  "summary": "전체적인 운세 총평 3~4문장. 신비롭고 깊이 있는 문체 사용.",
  "lines": [
    {"name": "생명선", "score": 4, "icon": "🌱", "desc": "건강과 활력에 대한 상세 분석 2문장"},
    {"name": "두뇌선", "score": 4, "icon": "💡", "desc": "지능과 판단력에 대한 상세 분석 2문장"},
    {"name": "감정선", "score": 4, "icon": "❤️", "desc": "애정운과 감수성에 대한 상세 분석 2문장"},
    {"name": "운명선", "score": 4, "icon": "🚀", "desc": "사회적 성취와 직업운에 대한 상세 분석 2문장"},
    {"name": "태양선", "score": 4, "icon": "☀️", "desc": "성공, 명성, 예술적 재능에 대한 분석 2문장"},
    {"name": "결혼선", "score": 4, "icon": "💍", "desc": "인연, 결혼운, 인간관계에 대한 분석 2문장"},
    {"name": "건강선", "score": 4, "icon": "🛡️", "desc": "신체적 강인함과 기운의 흐름에 대한 분석 2문장"},
    {"name": "재운선", "score": 4, "icon": "💰", "desc": "금전 흐름과 물질적 풍요에 대한 분석 2문장"}
  ],
  "lucky_color": "색상명",
  "lucky_number": 7
}

점수는 1~5 사이 정수입니다.
손금이 희미하거나 잘 보이지 않는 경우, 손바닥의 전반적인 형태와 기운을 바탕으로 '코스믹 마스터'답게 직관적으로 해석해 주세요.
분석 내용은 매우 구체적이고 사용자에게 희망과 조언을 주는 방향으로 작성하세요.`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const requestBody = JSON.stringify({
      contents: [{
        parts: [
          { text: prompt },
          { inline_data: { mime_type: safeMime, data: imageB64 } }
        ]
      }],
      generationConfig: {
        temperature: 0.85,
        maxOutputTokens: 2048, // Increased: 8 lines × 2 sentences each needs more room
        responseMimeType: 'application/json'
      }
    });

    // Retry logic with backoff for 429 (rate limit)
    let geminiRes;
    const maxRetries = 3;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      geminiRes = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: requestBody
      });

      if (geminiRes.status === 429 && attempt < maxRetries) {
        const waitMs = (attempt + 1) * 5000; // 5s, 10s, 15s
        console.log(`Rate limited (429). Waiting ${waitMs}ms before retry ${attempt + 1}/${maxRetries}...`);
        await new Promise(r => setTimeout(r, waitMs));
        continue;
      }
      break; // Success or non-429 error
    }

    if (!geminiRes.ok) {
      const errBody = await geminiRes.text();
      console.error('Gemini API Error:', geminiRes.status, errBody);

      if (geminiRes.status === 429) {
        return res.status(429).json({
          error: '요청이 너무 많습니다. 30초 후에 다시 시도해 주세요.'
        });
      }

      return res.status(502).json({
        error: `Gemini API 오류 (${geminiRes.status})`,
        details: errBody.slice(0, 500) // Don't leak full error to client
      });
    }

    const data = await geminiRes.json();

    // Safely extract the response text
    const candidate = data?.candidates?.[0];
    const rawText = candidate?.content?.parts?.[0]?.text;

    if (!rawText) {
      // Could be a safety block — check finishReason
      const finishReason = candidate?.finishReason;
      console.error('Unexpected Gemini response:', JSON.stringify(data));
      if (finishReason === 'SAFETY') {
        return res.status(422).json({ error: '손바닥 사진을 인식하지 못했습니다. 다른 사진으로 다시 시도해 주세요.' });
      }
      return res.status(502).json({ error: 'Gemini가 유효한 응답을 반환하지 않았습니다.' });
    }

    // Try to parse JSON, stripping markdown fences or surrounding text if present
    let parsed;
    try {
      // 1st attempt: direct parse
      const cleaned = rawText.replace(/```json\s*|\s*```/g, '').trim();
      parsed = JSON.parse(cleaned);
    } catch (_e1) {
      // 2nd attempt: extract first JSON object with regex
      try {
        const match = rawText.match(/\{[\s\S]*\}/);
        if (match) parsed = JSON.parse(match[0]);
      } catch (_e2) {
        console.error('JSON parse error. Raw:', rawText.slice(0, 300));
        return res.status(502).json({ error: '분석 결과를 해석하지 못했습니다. 다시 시도해 주세요.' });
      }
    }

    if (!parsed) {
      return res.status(502).json({ error: '분석 결과를 해석하지 못했습니다. 다시 시도해 주세요.' });
    }

    // Validate essential fields and provide safe defaults
    const result = {
      overall_title: String(parsed.overall_title || '신비로운 손금').slice(0, 30),
      stars: Math.min(5, Math.max(1, parseInt(parsed.stars) || 4)),
      summary: String(parsed.summary || '분석이 완료되었습니다.'),
      lines: Array.isArray(parsed.lines) ? parsed.lines.map(l => ({
        name: String(l.name || '손금').slice(0, 10),
        score: Math.min(5, Math.max(1, parseInt(l.score) || 3)),
        icon: String(l.icon || '✨').slice(0, 4),
        desc: String(l.desc || '분석 결과입니다.')
      })) : [],
      lucky_color: String(parsed.lucky_color || '보라색').slice(0, 15),
      lucky_number: parseInt(parsed.lucky_number) || 7
    };

    return res.status(200).json(result);
  } catch (error) {
    console.error('Server Error:', error);
    return res.status(500).json({ error: '서버 내부 오류가 발생했습니다.' });
  }
}
