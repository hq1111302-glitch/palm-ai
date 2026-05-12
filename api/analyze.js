// api/analyze.js
// Vercel Serverless Function — securely proxies Gemini API requests

export const config = {
  maxDuration: 30, // Allow up to 30 seconds for Gemini to respond
};

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { imageB64, mimeType } = req.body || {};

    if (!imageB64 || !mimeType) {
      return res.status(400).json({ error: '이미지 데이터가 없습니다.' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'GEMINI_API_KEY 환경 변수가 설정되지 않았습니다.' });
    }

    const model = 'gemini-2.0-flash';

    const prompt = `당신은 30년 경력의 신비로운 손금 전문가 '코스믹 마스터'입니다.
제공된 손바닥 사진을 보고 운명을 분석해 주세요.

반드시 아래 JSON 형식으로만 응답하세요. 마크다운 코드블록이나 다른 텍스트 없이 순수 JSON만 반환하세요.
{
  "overall_title": "분석을 요약하는 짧고 멋진 제목",
  "stars": 4,
  "summary": "전체적인 운세 총평 3~4문장",
  "lines": [
    {"name": "생명선", "score": 4, "icon": "🌱", "desc": "건강과 활력에 대한 상세 분석 2문장"},
    {"name": "두뇌선", "score": 4, "icon": "💡", "desc": "지능과 판단력에 대한 상세 분석 2문장"},
    {"name": "감정선", "score": 4, "icon": "❤️", "desc": "애정운과 감수성에 대한 상세 분석 2문장"},
    {"name": "운명선", "score": 4, "icon": "🚀", "desc": "사회적 성취에 대한 상세 분석 2문장"}
  ],
  "lucky_color": "색상명",
  "lucky_number": 7
}

점수와 별점은 1~5 사이 정수입니다.
톤앤매너는 신비롭고 희망적이며 전문적이어야 합니다.
손금이 잘 안 보여도 사진상의 특징을 기반으로 정성껏 분석하세요.`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const geminiRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            { inline_data: { mime_type: mimeType, data: imageB64 } }
          ]
        }],
        generationConfig: {
          temperature: 0.9,
          maxOutputTokens: 1024,
          responseMimeType: 'application/json'
        }
      })
    });

    if (!geminiRes.ok) {
      const errBody = await geminiRes.text();
      console.error('Gemini API Error:', geminiRes.status, errBody);
      return res.status(502).json({
        error: `Gemini API 오류 (${geminiRes.status})`,
        details: errBody
      });
    }

    const data = await geminiRes.json();

    // Safely extract the response text
    const candidate = data?.candidates?.[0];
    if (!candidate || !candidate.content?.parts?.[0]?.text) {
      console.error('Unexpected Gemini response shape:', JSON.stringify(data));
      return res.status(502).json({ error: 'Gemini가 유효한 응답을 반환하지 않았습니다.' });
    }

    const rawText = candidate.content.parts[0].text;

    // Try to parse JSON, stripping markdown fences if present
    let parsed;
    try {
      const cleaned = rawText.replace(/```json\s*|```\s*/g, '').trim();
      parsed = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error('JSON parse error:', parseErr.message, 'Raw:', rawText);
      return res.status(502).json({ error: '분석 결과를 해석하지 못했습니다. 다시 시도해 주세요.' });
    }

    // Validate essential fields and provide defaults
    const result = {
      overall_title: parsed.overall_title || '신비로운 손금',
      stars: Math.min(5, Math.max(1, parseInt(parsed.stars) || 4)),
      summary: parsed.summary || '분석이 완료되었습니다.',
      lines: Array.isArray(parsed.lines) ? parsed.lines.map(l => ({
        name: l.name || '손금',
        score: Math.min(5, Math.max(1, parseInt(l.score) || 3)),
        icon: l.icon || '✨',
        desc: l.desc || '분석 결과입니다.'
      })) : [],
      lucky_color: parsed.lucky_color || '보라색',
      lucky_number: parseInt(parsed.lucky_number) || 7
    };

    return res.status(200).json(result);
  } catch (error) {
    console.error('Server Error:', error);
    return res.status(500).json({ error: '서버 내부 오류가 발생했습니다.', message: error.message });
  }
}
