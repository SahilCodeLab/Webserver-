require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { OpenAI } = require('openai');
const PDFDocument = require('pdfkit');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;

// ======================
// 🛡️ Middleware & Security
// ======================
app.use(cors());
app.use(express.json());

// Rate limiting (100 requests per 15 mins per IP)
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: "Too many requests, please try again later."
}));

// ======================
// 🔑 API Key Configuration (Loaded from .env)
// ======================
const API_CONFIG = {
  ASSIGNMENT: {
    key: process.env.ASSIGNMENT_API_KEY,
    model: 'google/gemini-2.0-flash-exp:free'
  },
  LONG_ANSWER: {
    key: process.env.LONG_ANSWER_API_KEY,
    model: 'qwen/qwen3-coder:free'
  },
  SHORT_ANSWER: {
    key: process.env.SHORT_ANSWER_API_KEY,
    model: 'google/gemma-3n-e2b-it:free'
  },
  GENERAL: {
    key: process.env.GENERAL_API_KEY,
    model: 'zai-ai/glm-4.5-air:free'
  }
};

// ======================
// 🤖 AI Clients Initialization
// ======================
const aiClients = {};
Object.keys(API_CONFIG).forEach((service) => {
  aiClients[service.toLowerCase()] = new OpenAI({
    apiKey: API_CONFIG[service].key,
    baseURL: 'https://openrouter.ai/api/v1'
  });
});

// ======================
// 📜 Context Templates
// ======================
const CONTEXTS = {
  ASSIGNMENT: `You are an expert academic content generator...`,
  LONG_ANSWER: `Provide a detailed 300-500 word explanation...`,
  SHORT_ANSWER: `Give a concise 2-3 sentence answer...`,
  GENERAL: `You are a versatile AI assistant...`
};

// ======================
// ⚡ Optimized AI Response Generator
// ======================
async function generateAIResponse(prompt, type = 'GENERAL') {
  const client = aiClients[type.toLowerCase()];
  const model = API_CONFIG[type]?.model;
  const context = CONTEXTS[type];

  try {
    const completion = await client.chat.completions.create({
      model: model,
      messages: [
        { role: 'system', content: context },
        { role: 'user', content: prompt }
      ],
      temperature: type === 'SHORT_ANSWER' ? 0.3 : 0.7,
      max_tokens: type === 'LONG_ANSWER' ? 1000 : 500,
      extra_headers: {
        'HTTP-Referer': 'https://yourdomain.com',
        'X-Title': 'AI Service'
      }
    });

    return {
      text: completion.choices[0].message.content,
      model: model,
      type: type.toLowerCase()
    };
  } catch (error) {
    console.error(`❌ ${type} API Error:`, error.message);
    throw new Error(`Failed to generate ${type} response.`);
  }
}

// ======================
// 📄 PDF Generator (Optimized)
// ======================
function generatePDF(content, res, filename = 'output.pdf') {
  try {
    const doc = new PDFDocument();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=${filename}`);

    doc.pipe(res);
    doc.font('Helvetica').fontSize(12);
    content.split('\n').forEach((para) => {
      doc.text(para.trim()).moveDown();
    });
    doc.end();
  } catch (error) {
    res.status(500).json({ error: "PDF generation failed." });
  }
}

// ======================
// 🚀 API Endpoints
// ======================

// 1️⃣ Assignment Generator
app.post('/generate-assignment', async (req, res) => {
  try {
    const { prompt, topic, difficulty } = req.body;
    if (!prompt) return res.status(400).json({ error: "Prompt is required." });

    const result = await generateAIResponse(prompt, 'ASSIGNMENT');
    if (req.query.download === 'pdf') {
      return generatePDF(result.text, res, `assignment_${Date.now()}.pdf`);
    }
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 2️⃣ Short Answer (Fast)
app.post('/generate-short-answer', async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!prompt) return res.status(400).json({ error: "Prompt is required." });

    const result = await Promise.race([
      generateAIResponse(prompt, 'SHORT_ANSWER'),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 5000))
    ]);

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 3️⃣ Long Answer (Detailed)
app.post('/generate-long-answer', async (req, res) => {
  try {
    const { prompt, subtopics } = req.body;
    if (!prompt) return res.status(400).json({ error: "Prompt is required." });

    const enhancedPrompt = subtopics ? `Subtopics: ${subtopics.join(', ')}\n${prompt}` : prompt;
    const result = await generateAIResponse(enhancedPrompt, 'LONG_ANSWER');

    if (req.query.download === 'pdf') {
      return generatePDF(result.text, res, `long_answer_${Date.now()}.pdf`);
    }
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 4️⃣ General AI (Quiz/Grammar/Chat)
app.post('/general-ai', async (req, res) => {
  try {
    const { prompt, taskType } = req.body;
    if (!prompt) return res.status(400).json({ error: "Prompt is required." });

    const result = await generateAIResponse(
      taskType ? `[${taskType.toUpperCase()} TASK]\n${prompt}` : prompt,
      'GENERAL'
    );
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ======================
// 🏥 Health Check
// ======================
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'active',
    services: Object.keys(API_CONFIG).map(key => ({
      service: key.toLowerCase(),
      model: API_CONFIG[key].model.split('/')[1],
      status: 'OK'
    })),
    uptime: process.uptime()
  });
});

// ======================
// 🌐 Start Server
// ======================
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log("🔌 Loaded AI Services:");
  Object.keys(API_CONFIG).forEach(service => {
    console.log(`   ▸ ${service}: ${API_CONFIG[service].model}`);
  });
});