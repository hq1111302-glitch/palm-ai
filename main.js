(function(){
  const MODEL = "gemini-1.5-flash";
  let currentImageUrl = null;
  let currentResult = null;
  let scanCancelled = false;

  // Stars background
  const starsCanvas = document.getElementById('starsCanvas');
  const starsCtx = starsCanvas.getContext('2d');
  let stars = [];

  function initStars(){
    const app = document.getElementById('palmApp');
    starsCanvas.width = app.offsetWidth || 430;
    starsCanvas.height = app.offsetHeight || window.innerHeight;
    stars = Array.from({length:90},()=>({
      x:Math.random()*starsCanvas.width, y:Math.random()*starsCanvas.height,
      r:Math.random()*1.3+0.2, alpha:Math.random(), speed:Math.random()*0.006+0.002
    }));
  }

  function drawStars(){
    starsCtx.clearRect(0,0,starsCanvas.width,starsCanvas.height);
    stars.forEach(s=>{
      s.alpha+=s.speed;
      if(s.alpha>1||s.alpha<0) s.speed*=-1;
      starsCtx.globalAlpha=Math.max(0,Math.min(1,s.alpha));
      starsCtx.fillStyle='#fff';
      starsCtx.beginPath();
      starsCtx.arc(s.x,s.y,s.r,0,Math.PI*2);
      starsCtx.fill();
    });
    requestAnimationFrame(drawStars);
  }

  initStars(); 
  drawStars();

  // Navigation
  window.goTo = function(id){
    document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
  };

  window.resetApp = function(){
    currentImageUrl=null; 
    currentResult=null; 
    scanCancelled=true;
    document.getElementById('uploadErr').textContent='';
    document.getElementById('fileInput').value='';
    document.getElementById('thumbImg').style.display = 'none';
    goTo('introScreen');
  };

  // File handling
  const fileInput = document.getElementById('fileInput');
  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if(!file) return;

    currentImageUrl = URL.createObjectURL(file);
    const mime = file.type || 'image/jpeg';
    scanCancelled = false;
    
    goTo('scanningScreen');
    startScanAnimation();

    const b64 = await toBase64(file);
    const msgs = ['생명선을 읽는 중...', '감정의 흐름을 분석 중...', '운명의 교차점을 찾는 중...', '✦ 분석 완료'];
    let mi = 0;
    const scanText = document.getElementById('scanText');
    scanText.textContent = msgs[0];

    const iv = setInterval(() => { 
      mi++; 
      if(mi < msgs.length) scanText.textContent = msgs[mi]; 
      else clearInterval(iv); 
    }, 1100);

    try {
      const result = await analyzePalm(b64, mime);
      currentResult = result; 
      clearInterval(iv);
      
      // Save to history
      saveToHistory(result, currentImageUrl);
      
      setTimeout(() => { 
        renderResult(result); 
        goTo('resultScreen'); 
      }, 500);
    } catch (err) {
      console.error(err);
      clearInterval(iv);
      document.getElementById('uploadErr').textContent = '분석에 실패했어요. API 키를 확인하거나 다시 시도해주세요.';
      goTo('uploadScreen');
    }
  });

  function startScanAnimation(){
    const canvas = document.getElementById('scanCanvas');
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    if(!currentImageUrl) return;

    const img = new Image();
    img.onload = () => {
      let scanY = 0;
      const particles = Array.from({length: 80}, () => makeParticle(W, H));
      
      function frame(){
        if(scanCancelled) return;
        ctx.clearRect(0, 0, W, H);
        
        const aspect = img.width / img.height;
        let dw = W, dh = W / aspect;
        if(dh > H) { dh = H; dw = H * aspect; }
        const dx = (W - dw) / 2, dy = (H - dh) / 2;
        
        ctx.globalAlpha = 1; 
        ctx.drawImage(img, dx, dy, dw, dh);
        
        ctx.globalAlpha = 0.15; 
        ctx.fillStyle = '#4C1D95';
        ctx.fillRect(dx, dy, dw, dh); 
        
        ctx.globalAlpha = 1;
        scanY = (scanY + 2.2) % H;
        
        // Dynamic Glow
        const glowSize = 40 + Math.sin(Date.now() * 0.005) * 10;
        const lg = ctx.createLinearGradient(0, scanY - glowSize, 0, scanY + glowSize);
        lg.addColorStop(0, 'rgba(168, 85, 247, 0)');
        lg.addColorStop(0.5, 'rgba(168, 85, 247, 0.4)');
        lg.addColorStop(1, 'rgba(168, 85, 247, 0)');
        
        ctx.fillStyle = lg; 
        ctx.fillRect(0, scanY - glowSize, W, glowSize * 2);
        
        ctx.globalAlpha = 0.9; 
        ctx.strokeStyle = '#F2C94C'; 
        ctx.lineWidth = 2;
        ctx.shadowColor = '#F2C94C'; 
        ctx.shadowBlur = 15;
        
        ctx.beginPath(); 
        ctx.moveTo(0, scanY); 
        ctx.lineTo(W, scanY); 
        ctx.stroke();
        
        ctx.shadowBlur = 0; 
        ctx.globalAlpha = 1;
        
        particles.forEach(p => {
          p.x += p.vx; 
          p.y += p.vy; 
          p.life -= 0.008;
          if(p.life <= 0) Object.assign(p, makeParticle(W, H));
          
          // Particles respond to scan line
          const distToScan = Math.abs(p.y - scanY);
          const activeGlow = distToScan < 30 ? 1 : 0.3;
          
          ctx.globalAlpha = Math.max(0, p.life * activeGlow);
          ctx.fillStyle = p.color; 
          ctx.shadowColor = p.color; 
          ctx.shadowBlur = 8;
          ctx.beginPath(); 
          ctx.arc(p.x, p.y, p.size * (distToScan < 20 ? 1.5 : 1), 0, Math.PI * 2); 
          ctx.fill();
          ctx.shadowBlur = 0;
        });
        ctx.globalAlpha = 1;
        requestAnimationFrame(frame);
      }
      frame();
    };
    img.src = currentImageUrl;
  }

  function makeParticle(W, H){
    return {
      x: W * 0.15 + Math.random() * W * 0.7, 
      y: H * 0.4 + Math.random() * H * 0.45,
      vx: (Math.random() - 0.5) * 1.1, 
      vy: -Math.random() * 1.6 - 0.4,
      life: 0.6 + Math.random() * 0.4,
      color: Math.random() > 0.5 ? '#F2C94C' : '#A855F7',
      size: Math.random() * 2.2 + 0.8
    };
  }

  function toBase64(file){
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result.split(',')[1]);
      r.onerror = rej; 
      r.readAsDataURL(file);
    });
  }

  async function analyzePalm(b64, mime){
    const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
    if (!apiKey || apiKey === 'your_gemini_api_key_here') {
      throw new Error('Gemini API Key not set');
    }

    const url = `/api/gemini/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;

    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: `당신은 수십 년 경력의 정통 수상학(Palmistry) 전문가입니다. 제공된 손바닥 사진을 면밀히 분석하여 전통적인 손금 해석 원칙에 따라 운세를 읽어주세요.

각 선(생명선, 감정선, 두뇌선, 운명선)을 분석할 때, 반드시 사진에서 관찰되는 **구체적인 시각적 특징(예: 선의 길이, 진하기, 갈라짐, 곡률, 시작점 등)**을 먼저 언급하고 그에 따른 해석을 덧붙여주세요.

반드시 아래 JSON 형식으로만 응답하세요. 마크다운이나 코드블록 없이 순수 JSON만 반환하세요.
{"생명선":{"해석":"선의 시각적 특징을 포함한 전문적인 해석 2~3문장","점수":4},"감정선":{"해석":"선의 시각적 특징을 포함한 전문적인 해석 2~3문장","점수":5},"두뇌선":{"해석":"선의 시각적 특징을 포함한 전문적인 해석 2~3문장","점수":3},"운명선":{"해석":"선의 시각적 특징을 포함한 전문적인 해석 2~3문장","점수":4},"종합운세":"전체적인 손의 형상과 주요 선들의 조화를 바탕으로 한 신비롭고 희망적인 요약 3~4문장","별점":4,"행운의색":"색상명","행운의숫자":7}

손금이 불명확해도 가장 유사한 특징을 찾아 반드시 JSON을 반환하세요. 점수와 별점은 1~5 정수.` },
            {
              inline_data: {
                mime_type: mime,
                data: b64
              }
            }
          ]
        }]
      })
    });

    if (!resp.ok) {
      const errData = await resp.json();
      throw new Error(errData.error?.message || 'Gemini API request failed');
    }

    const data = await resp.json();
    let raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    raw = raw.replace(/```json|```/g, '').trim();
    
    try {
      const parsed = JSON.parse(raw);
      // Ensure all required fields exist
      const lines = ['생명선', '감정선', '두뇌선', '운명선'];
      lines.forEach(l => {
        if (!parsed[l]) parsed[l] = { 해석: "분석 결과를 가져올 수 없습니다.", 점수: 3 };
      });
      return parsed;
    } catch (e) {
      console.error("JSON Parse Error:", raw);
      throw new Error("결과 분석 중 오류가 발생했습니다.");
    }
  }

  // History Logic
  function saveToHistory(result, imgUrl) {
    const history = JSON.parse(localStorage.getItem('palm_history') || '[]');
    const newItem = {
      id: Date.now(),
      date: new Date().toLocaleString('ko-KR'),
      result: result,
      image: imgUrl // Note: Blob URLs won't persist across reloads, but good for current session
    };
    history.unshift(newItem);
    localStorage.setItem('palm_history', JSON.stringify(history.slice(0, 20))); // Keep last 20
  }

  window.showHistory = function() {
    const history = JSON.parse(localStorage.getItem('palm_history') || '[]');
    const list = document.getElementById('historyList');
    list.innerHTML = '';
    
    if (history.length === 0) {
      list.innerHTML = '<div class="empty-history">아직 분석 기록이 없습니다.</div>';
    } else {
      history.forEach(item => {
        const div = document.createElement('div');
        div.className = 'history-item fade-up';
        div.innerHTML = `
          <div class="history-info">
            <div class="history-date">${item.date}</div>
            <div class="history-summary">${item.result.종합운세.substring(0, 30)}...</div>
            <div class="history-stars">${'★'.repeat(item.result.별점 || 4)}${'☆'.repeat(5 - (item.result.별점 || 4))}</div>
          </div>
          <div class="card-icon">👉</div>
        `;
        div.onclick = () => {
          currentResult = item.result;
          renderResult(item.result);
          goTo('resultScreen');
        };
        list.appendChild(div);
      });
    }
    goTo('historyScreen');
  };

  window.clearHistory = function() {
    if (confirm('모든 기록을 삭제하시겠습니까?')) {
      localStorage.removeItem('palm_history');
      showHistory();
    }
  };

  function renderResult(r){
    const thumb = document.getElementById('thumbImg');
    if(currentImageUrl) {
      thumb.src = currentImageUrl;
      thumb.style.display = 'block';
    }
    
    const s = Math.min(5, Math.max(1, r.별점 || 4));
    document.getElementById('starsDisplay').textContent = '★'.repeat(s) + '☆'.repeat(5 - s);
    
    const lines = [
      { key: '생명선', icon: '💛', color: '#F2C94C', label: '건강운' },
      { key: '감정선', icon: '💜', color: '#A855F7', label: '연애운' },
      { key: '두뇌선', icon: '💙', color: '#3B82F6', label: '재물운' },
      { key: '운명선', icon: '💚', color: '#10B981', label: '직업운' },
    ];
    
    const container = document.getElementById('cardsContainer');
    container.innerHTML = '';
    
    lines.forEach((line, idx) => {
      const d = r[line.key] || {};
      const score = Math.min(5, Math.max(1, d.점수 || 3));
      const dots = [1, 2, 3, 4, 5].map(i => `<div class="sdot" style="background:${i <= score ? line.color : 'rgba(255,255,255,0.12)'};box-shadow:${i <= score ? '0 0 6px ' + line.color : 'none'}"></div>`).join('');
      
      const card = document.createElement('div');
      card.className = `line-card fade-up fade-up-${idx + 1}`;
      card.style.borderLeft = `2px solid ${line.color}40`;
      card.innerHTML = `<div class="card-top"><span class="card-icon">${line.icon}</span><div><div class="card-label" style="color:${line.color}">${line.key}</div><div class="card-sublabel">${line.label}</div></div><div class="score-dots">${dots}</div></div><div class="card-text">${d.해석 || ''}</div>`;
      container.appendChild(card);
    });
    
    const sc = document.getElementById('summaryCard');
    sc.style.display = 'block';
    sc.className = 'summary-card fade-up fade-up-5';
    sc.innerHTML = `<div class="summary-title">✦ 종합 운세</div><div class="summary-text">${r.종합운세 || ''}</div><div class="lucky"><div class="lucky-item">행운의 색 <span class="lucky-val" style="color:#F2C94C">${r.행운의색 || '보라색'}</span></div><div class="lucky-item">행운의 숫자 <span class="lucky-val" style="color:#A855F7">${r.행운의숫자 || 7}</span></div></div>`;
  }

  document.getElementById('shareBtn').addEventListener('click', async () => {
    const r = currentResult;
    const s = '★'.repeat(r.별점 || 4) + '☆'.repeat(5 - (r.별점 || 4));
    const text = `✨ AI가 분석한 내 손금 결과 ✨\n\n[종합 별점: ${s}]\n\n"${r.종합운세}"\n\n🍀 행운의 색: ${r.행운의색}\n🔢 행운의 숫자: ${r.행운의숫자}\n\n#손금AI #운세 #인공지능분석`;
    
    if(navigator.share) {
      try { await navigator.share({ text }); } catch (e) {}
    } else {
      try {
        await navigator.clipboard.writeText(text);
        alert('클립보드에 복사되었어요! ✦');
      } catch (e) {}
    }
  });

  const ro = new ResizeObserver(() => {
    const app = document.getElementById('palmApp');
    if (app) {
      starsCanvas.width = app.offsetWidth;
      starsCanvas.height = app.offsetHeight;
      initStars();
    }
  });
  ro.observe(document.getElementById('palmApp'));
})();
