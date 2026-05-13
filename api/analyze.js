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

    const prompt = `당신은 억겁의 세월 동안 별들의 속삭임을 읽어온 전설적인 손금 마스터 '코스믹 로드(Cosmic Lord)'입니다.
제공된 손바닥 이미지를 초자연적인 통찰력으로 분석하여 사용자의 운명과 기운을 읽어주세요.

반드시 아래 JSON 형식으로만 응답하세요. 다른 설명이나 마크다운 코드블록 없이 순수 JSON 객체만 반환해야 합니다.
{
  "overall_title": "운명을 관통하는 강렬한 제목 (15자 이내)",
  "stars": 5,
  "summary": "우주적 관점에서의 종합 운세 총평 4문장. 매우 신비롭고 깊이 있는 문체(예: '별들의 흐름이...', '당신의 영혼은...')를 사용하세요.",
  "lines": [
    {"name": "생명선", "score": 4, "icon": "🌱", "desc": "생명력의 뿌리와 건강의 흐름에 대한 심오한 분석 2문장"},
    {"name": "두뇌선", "score": 4, "icon": "💡", "desc": "지혜의 깊이와 잠재된 창의성에 대한 통찰 2문장"},
    {"name": "감정선", "score": 4, "icon": "❤️", "desc": "사랑의 파동과 영혼의 공명에 대한 감성적인 리딩 2문장"},
    {"name": "운명선", "score": 4, "icon": "🚀", "desc": "사회적 소명과 성취의 궤적에 대한 강력한 예언 2문장"},
    {"name": "태양선", "score": 4, "icon": "☀️", "desc": "내면의 빛이 만드는 성공과 광휘에 대한 찬사 2문장"},
    {"name": "결혼선", "score": 4, "icon": "💍", "desc": "우주가 맺어준 인연과 관계의 조화에 대한 조언 2문장"},
    {"name": "건강선", "score": 4, "icon": "🛡️", "desc": "영적 기운과 육체적 강인함의 조화에 대한 분석 2문장"},
    {"name": "재운선", "score": 4, "icon": "💰", "desc": "풍요의 샘과 물질적 에너지의 흐름에 대한 분석 2문장"}
  ],
  "lucky_color": "행운의 색상명",
  "lucky_number": 7
}

분석 시 주의사항:
1. 손금이 희미하더라도 손의 전반적인 형태, 피부의 결, 손가락의 비율 등을 통해 '코스믹 로드'다운 직관적 해석을 내려주세요.
2. 각 손금의 점수(1~5)는 절대적인 가치가 아닌, 현재 우주가 당신에게 보내는 에너지의 강도를 의미합니다.
3. 모든 설명은 사용자에게 깊은 영감과 긍정적인 에너지를 줄 수 있도록 작성하세요.
4. 분석 결과가 '이미지에 손이 없음'인 경우에도, 주변의 기운을 읽어 '신비로운 조언'을 남겨주되 JSON 형식을 반드시 유지하세요.`;

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
