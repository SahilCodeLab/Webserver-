require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { OpenAI } = require('openai');
const rateLimit = require('express-rate-limit');
const PDFDocument = require('pdfkit');
const fs = require('fs');

const app = express();
app.set('trust proxy', 1); // ✅ Rate limiter ke warning fix ke liye
const PORT = process.env.PORT || 10000;

// Load API keys from .env
const {
  OPENROUTER_KEY_FOR_SHORT_ANSWER,
  OPENROUTER_KEY_FOR_ASSIGNMENT,
  OPENROUTER_KEY_FOR_LONG_ANSWER,
  OPENROUTER_KEY_FOR_ALL_IN_ONE
} = process.env;

if (!OPENROUTER_KEY_FOR_SHORT_ANSWER || !OPENROUTER_KEY_FOR_ASSIGNMENT || !OPENROUTER_KEY_FOR_LONG_ANSWER || !OPENROUTER_KEY_FOR_ALL_IN_ONE) {
  console.error('❌ .env file mein chaaron (4) dedicated API keys zaroori hain!');
  process.exit(1);
}

// Clients for different tasks
const shortAnswerClient = new OpenAI({ apiKey: OPENROUTER_KEY_FOR_SHORT_ANSWER, baseURL: 'https://openrouter.ai/api/v1' });
const assignmentClient = new OpenAI({ apiKey: OPENROUTER_KEY_FOR_ASSIGNMENT, baseURL: 'https://openrouter.ai/api/v1' });
const longAnswerClient = new OpenAI({ apiKey: OPENROUTER_KEY_FOR_LONG_ANSWER, baseURL: 'https://openrouter.ai/api/v1' });
const allInOneClient = new OpenAI({ apiKey: OPENROUTER_KEY_FOR_ALL_IN_ONE, baseURL: 'https://openrouter.ai/api/v1' });

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100 });
app.use('/generate-*', limiter);

// PDF generator
function generatePDF(content, res, title = 'EduSmart AI') {
  try {
    const doc = new PDFDocument({ margin: 50, size: 'A4', bufferPages: true });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${title.toLowerCase().replace(/[^a-z0-9]/g, '-')}.pdf"`);
    doc.pipe(res);

    if (fs.existsSync('logo.png')) {
      doc.image('logo.png', 50, 45, { width: 100 });
    }

    doc.font('Helvetica-Bold').fontSize(20).fillColor('blue').text(title, { align: 'center' });
    doc.moveDown(2);
    doc.font('Helvetica').fontSize(12).fillColor('black').text(content, { align: 'left', lineGap: 4 });

    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.fontSize(8).fillColor('#888').text(`EduSmart AI • Page ${i + 1} of ${range.count}`, 50, doc.page.height - 50, { align: 'center' });
    }

    doc.end();
  } catch (error) {
    console.error("PDF generation error:", error);
    res.status(500).json({ error: "PDF banane mein dikkat hui." });
  }
}

// Generic AI handler
async function generateAIResponse(prompt, context, taskPreference) {
  const taskConfig = {
    'short': { model: 'google/gemma-3n-e2b-it:free', client: shortAnswerClient, keyName: 'SHORT_ANSWER' },
    'assignment': { model: 'google/gemini-2.0-flash-exp:free', client: assignmentClient, keyName: 'ASSIGNMENT' },
    'long': { model: 'qwen/qwen3-coder:free', client: longAnswerClient, keyName: 'LONG_ANSWER' },
    'quiz': { model: 'z-ai/glm-4.5-air:free', client: allInOneClient, keyName: 'ALL_IN_ONE' },
    'grammar': { model: 'z-ai/glm-4.5-air:free', client: allInOneClient, keyName: 'ALL_IN_ONE' },
    'chat': { model: 'z-ai/glm-4.5-air:free', client: allInOneClient, keyName: 'ALL_IN_ONE' },
  };

  const config = taskConfig[taskPreference];
  if (!config) throw new Error(`❌ Unknown task type: ${taskPreference}`);

  try {
    const completion = await config.client.chat.completions.create({
      model: config.model,
      messages: [{ role: 'system', content: context }, { role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 3000,
    });

    const result = completion.choices[0]?.message?.content?.trim();
    if (!result) throw new Error('AI response khaali mila.');
    return { text: result, modelUsed: config.model };
  } catch (error) {
    console.error(`❌ Error (${config.keyName}):`, error.message);
    throw new Error(`AI se response lene mein error: ${config.keyName}`);
  }
}

// === Endpoints ===

app.post('/generate-assignment', async (req, res) => {
  try {
    const { prompt } = req.body;
    const result = await generateAIResponse(prompt, `Create an assignment on "${prompt}".`, 'assignment');
    if (req.query.download === 'pdf') return generatePDF(result.text, res, `Assignment - ${prompt}`);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/generate-long-answer', async (req, res) => {
  try {
    const { prompt } = req.body;
    const result = await generateAIResponse(prompt, `Write a detailed long-form answer about "${prompt}".`, 'long');
    if (req.query.download === 'pdf') return generatePDF(result.text, res, `Long Answer - ${prompt}`);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/generate-short-answer', async (req, res) => {
  try {
    const { prompt } = req.body;
    const result = await generateAIResponse(prompt, `Give a short and crisp answer for "${prompt}".`, 'short');
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/generate-quiz', async (req, res) => {
  try {
    const { prompt } = req.body;
    const result = await generateAIResponse(prompt, `Generate a quiz on the topic "${prompt}".`, 'quiz');
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/fix-grammar', async (req, res) => {
  try {
    const { text } = req.body;
    const result = await generateAIResponse(text, `Correct the grammar of the given sentence.`, 'grammar');
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/chat', async (req, res) => {
  try {
    const { message } = req.body;
    const result = await generateAIResponse(message, `You're a friendly AI chatbot.`, 'chat');
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Default Error Handler
app.use((err, req, res, next) => {
  console.error('❌ Server Error:', err.message);
  res.status(500).json({ error: err.message });
});

// Start Server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server live on port ${PORT}`);
});