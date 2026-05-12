// api/analyze.js
// Vercel Serverless Function to securely proxy Gemini API requests

export default async function handler(req, res) {
  // 1. Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { imageB64, mimeType } = req.body;
  if (!imageB64 || !mimeType) {
    return res.status(400).json({ error: 'Missing image data' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured in Vercel environment variables' });
  }

  const model = "gemini-1.5-flash";
  const prompt = `당신은 30년 경력의 신비로운 손금 전문가 '코스믹 마스터'입니다. 제공된 손바닥 사진을 보고 운명을 분석해 주세요. 
            분석 결과는 반드시 다음과 같은 JSON 형식으로만 응답하세요. 다른 텍스트는 절대 포함하지 마세요.
            {
                "overall_title": "분석을 요약하는 짧고 멋진 제목 (예: 끊임없는 도전의 개척자)",
                "stars": 1~5 정수,
                "summary": "전체적인 운세 총평 3~4문장",
                "lines": [
                    {"name": "생명선", "score": 1~5, "icon": "🌱", "desc": "건강과 활력에 대한 상세 분석 2문장"},
                    {"name": "두뇌선", "score": 1~5, "icon": "💡", "desc": "지능과 판단력, 재능에 대한 상세 분석 2문장"},
                    {"name": "감정선", "score": 1~5, "icon": "❤️", "desc": "애정운과 감수성에 대한 상세 분석 2문장"},
                    {"name": "운명선", "score": 1~5, "icon": "🚀", "desc": "사회적 성취와 직업적 흐름에 대한 상세 분석 2문장"}
                ],
                "lucky_color": "행운의 색상명",
                "lucky_number": 1~99 사이의 정수
            }
            톤앤매너는 신비롭고 희망적이며 전문적이어야 합니다. 손금이 잘 안 보여도 사진상의 특징(피부결, 두께, 색깔 등)을 기반으로 정성껏 분석하세요.`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            { inline_data: { mime_type: mimeType, data: imageB64 } }
          ]
        }]
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('Gemini API Error:', errorData);
      return res.status(response.status).json({ error: 'Gemini API call failed', details: errorData });
    }

    const data = await response.json();
    const textResponse = data.candidates[0].content.parts[0].text;
    
    // Clean JSON if model returns markdown block
    const cleanJson = textResponse.replace(/```json|```/g, "").trim();
    const parsedData = JSON.parse(cleanJson);
    
    return res.status(200).json(parsedData);
  } catch (error) {
    console.error('Server Error:', error);
    return res.status(500).json({ error: 'Internal server error', message: error.message });
  }
}
