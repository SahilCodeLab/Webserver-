require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { OpenAI } = require('openai');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? ['https://yourdomain.com', 'https://www.yourdomain.com'] 
    : '*'
}));
app.use(express.json({ limit: '10mb' }));
app.use('/api-docs', express.static(path.join(__dirname, 'docs')));

// Rate limiting
const rateLimit = require('express-rate-limit');
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});
app.use('/generate-*', limiter);

// Environment Keys
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
if (!OPENROUTER_API_KEY) {
  console.error('❌ OPENROUTER_API_KEY is required in .env file');
  process.exit(1);
}

// OpenRouter Client - Properly configured
const openai = new OpenAI({
  apiKey: OPENROUTER_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1',
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Server Error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Health check with detailed status
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'operational',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    features: {
      assignmentGenerator: true,
      longAnswer: true,
      shortAnswer: true,
      quizGenerator: true,
      grammarFixer: true,
      aiTutorChat: true,
      pdfExport: true
    },
    models: {
      primary: 'OpenRouter AI Models',
      fallback: 'None (OpenRouter only)'
    },
    environment: process.env.NODE_ENV || 'development'
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'Welcome to EduSmart AI API',
    documentation: '/api-docs',
    endpoints: [
      'POST /generate-assignment',
      'POST /generate-long-answer', 
      'POST /generate-short-answer',
      'POST /generate-quiz',
      'POST /fix-grammar',
      'POST /chat',
      'GET /health'
    ],
    status: 'active'
  });
});

// ✨ Unified AI Response Generator with enhanced error handling
async function generateAIResponse(prompt, context, modelPreference = 'auto') {
  if (!prompt || !context) {
    throw new Error('Prompt and context are required');
  }

  // Model mapping for specific use cases
  const modelMap = {
    assignment: 'google/gemini-2.0-flash-exp:free',
    long: 'google/gemini-2.0-flash-exp:free',
    short: 'qwen/qwen3-coder:free',
    quiz: 'z-ai/glm-4.5-air:free',
    grammar: 'qwen/qwen3-coder:free',
    chat: 'z-ai/glm-4.5-air:free',
    auto: 'google/gemini-2.0-flash-exp:free'
  };

  const model = modelMap[modelPreference] || modelMap.auto;
  const fullPrompt = `${context}\n\n${prompt}`.trim();

  try {
    console.log(`🎯 Using model: ${model} for request`);

    const completion = await openai.chat.completions.create({
      model: model,
      messages: [
        { role: 'system', content: context },
        { role: 'user', content: prompt }
      ],
      temperature: 0.7,
      max_tokens: 2048,
      extra_headers: {
        'HTTP-Referer': process.env.SITE_URL || 'http://localhost:3000',
        'X-Title': process.env.SITE_NAME || 'EduSmart AI'
      }
    });

    const result = completion.choices[0]?.message?.content;
    if (!result) {
      throw new Error('Empty response from AI model');
    }

    return {
      text: result,
      source: 'openrouter',
      modelUsed: model,
      tokens: completion.usage?.total_tokens || 0,
      timestamp: new Date().toISOString()
    };

  } catch (error) {
    console.error('❌ AI Generation Error:', {
      model,
      error: error.message,
      status: error.status,
      headers: error.headers
    });

    // Provide more specific error messages
    let errorMessage = 'AI service is currently unavailable. Please try again later.';
    
    if (error.status === 401) {
      errorMessage = 'Authentication failed. Please check your API key configuration.';
    } else if (error.status === 429) {
      errorMessage = 'Rate limit exceeded. Please try again later.';
    } else if (error.status === 404) {
      errorMessage = `Model '${model}' not found. Please check model name or contact support.`;
    }

    throw new Error(errorMessage);
  }
}

// 📄 PDF Generator Function with enhanced styling
function generatePDF(content, res, title = 'EduSmart AI Document') {
  try {
    const doc = new PDFDocument({
      margin: 50,
      size: 'A4',
      bufferPages: true
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${title.toLowerCase().replace(/[^a-zA-Z0-9]/g, '-')}.pdf"`);

    // Pipe the PDF to the response
    doc.pipe(res);

    // Add header
    doc.image('https://via.placeholder.com/100x40?text=EduSmart+AI', 50, 45, { width: 100 })
       .fillColor('#2563eb')
       .fontSize(18)
       .text(title, 160, 55);

    // Add horizontal line
    doc.moveTo(50, 100)
       .lineTo(550, 100)
       .strokeColor('#e5e7eb')
       .stroke();

    // Add content
    doc.fillColor('#1f2937')
       .fontSize(12)
       .font('Helvetica')
       .text(content, {
         x: 50,
         y: 120,
         width: 500,
         align: 'left',
         lineGap: 4,
         indent: 0,
         paragraphGap: 4
       });

    // Add footer
    const pages = doc.bufferedPageRange();
    for (let i = 0; i < pages.count; i++) {
      doc.switchToPage(i);
      const oldBottomMargin = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc.fillColor('#6b7280')
          .fontSize(10)
          .text(
            `Page ${i + 1} of ${pages.count} • Generated by EduSmart AI • ${new Date().toLocaleDateString()}`,
            50,
            780,
            { align: 'center' }
          );
      doc.page.margins.bottom = oldBottomMargin;
    }

    // Finalize the PDF
    doc.end();

  } catch (error) {
    console.error('PDF Generation Error:', error);
    res.status(500).json({ error: 'Failed to generate PDF document' });
  }
}

// 🚀 Assignment Generator Endpoint
app.post('/generate-assignment', async (req, res) => {
  try {
    const { prompt, level = 'high-school', subject = 'General' } = req.body;
    
    if (!prompt) {
      return res.status(400).json({ 
        error: 'Prompt is required',
        example: { prompt: 'Photosynthesis in plants' }
      });
    }

    const context = `You are an expert educator creating assignments. 
    Create a comprehensive assignment for ${level} level ${subject} students on "${prompt}".
    Include: Learning objectives, Instructions, Tasks/Questions, Evaluation criteria, 
    and Submission guidelines. Use clear, academic language.`;

    const result = await generateAIResponse(prompt, context, 'assignment');
    
    // PDF export option
    if (req.query.download === 'pdf') {
      return generatePDF(result.text, res, `Assignment - ${prompt}`);
    }
    
    res.json({
      ...result,
      type: 'assignment',
      subject,
      level,
      wordCount: result.text.split(' ').length
    });

  } catch (error) {
    res.status(500).json({ 
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// 📚 Long Answer Endpoint
app.post('/generate-long-answer', async (req, res) => {
  try {
    const { prompt, wordCount = '300-500' } = req.body;
    if (!prompt) return res.status(400).json({ error: 'Prompt is required' });

    const context = `Provide a detailed ${wordCount} word comprehensive explanation on "${prompt}".
    Structure with: Introduction, Main Body (with subheadings), Examples, and Conclusion.
    Use academic language and ensure factual accuracy.`;

    const result = await generateAIResponse(prompt, context, 'long');
    
    if (req.query.download === 'pdf') {
      return generatePDF(result.text, res, `Long Answer - ${prompt}`);
    }
    
    res.json({
      ...result,
      type: 'long-answer',
      wordCount: wordCount,
      readingTime: Math.ceil(result.text.split(' ').length / 200) + ' minutes'
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 🧠 Short Answer Endpoint
app.post('/generate-short-answer', async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!prompt) return res.status(400).json({ error: 'Prompt is required' });

    const context = `Provide a concise, accurate 2-3 sentence answer to "${prompt}".
    Be direct, factual, and focus on the essential information only.`;

    const result = await generateAIResponse(prompt, context, 'short');
    res.json({
      ...result,
      type: 'short-answer',
      sentenceCount: (result.text.match(/\./g) || []).length
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 🧩 Quiz Generator Endpoint
app.post('/generate-quiz', async (req, res) => {
  try {
    const { 
      prompt, 
      difficulty = 'medium', 
      questionCount = 5,
      quizType = 'mixed' 
    } = req.body;

    if (!prompt) return res.status(400).json({ error: 'Topic is required' });

    const context = `Generate a ${questionCount}-question ${quizType} quiz on "${prompt}" at ${difficulty} difficulty.
    Include: Multiple choice (MCQ), True/False, and Short answer questions.
    Format each question clearly with answers at the end.
    Add a brief explanation for each answer.`;

    const result = await generateAIResponse(prompt, context, 'quiz');
    
    if (req.query.download === 'pdf') {
      return generatePDF(result.text, res, `Quiz - ${prompt}`);
    }
    
    res.json({
      ...result,
      type: 'quiz',
      difficulty,
      questionCount,
      quizType
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ✅ Grammar Fixer Endpoint
app.post('/fix-grammar', async (req, res) => {
  try {
    const { text, style = 'academic' } = req.body;
    if (!text) return res.status(400).json({ error: 'Text is required' });

    const context = `You are an expert editor. Improve the grammar, punctuation, clarity, 
    and ${style} style of the following text while preserving the original meaning.
    Return only the corrected version with improvements.`;

    const result = await generateAIResponse(text, context, 'grammar');
    res.json({
      ...result,
      type: 'grammar-correction',
      originalLength: text.length,
      correctedLength: result.text.length,
      style
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 💬 AI Chat Tutor Endpoint
app.post('/chat', async (req, res) => {
  try {
    const { message, history = [], studentLevel = 'high-school' } = req.body;
    if (!message) return res.status(400).json({ error: 'Message is required' });

    const context = `You are an AI tutor for ${studentLevel} students. 
    Be helpful, patient, and educational. Explain concepts clearly with relatable examples.
    Keep responses engaging and appropriate for learners.
    Current conversation history: ${JSON.stringify(history.slice(-3))}`;

    const result = await generateAIResponse(message, context, 'chat');
    res.json({
      ...result,
      type: 'tutor-response',
      studentLevel,
      conversationLength: history.length + 1
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add OPTIONS endpoints for CORS preflight
app.options('/generate-*', cors());

// 404 handler for undefined routes
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    availableEndpoints: [
      'POST /generate-assignment',
      'POST /generate-long-answer',
      'POST /generate-short-answer', 
      'POST /generate-quiz',
      'POST /fix-grammar',
      'POST /chat',
      'GET /health'
    ]
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received. Shutting down gracefully...');
  server.close(() => {
    console.log('Process terminated');
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received. Shutting down gracefully...');
  server.close(() => {
    console.log('Process terminated');
  });
});

// Start server
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 EduSmart AI Server running on port ${PORT}`);
  console.log(`📡 API Base: http://localhost:${PORT}`);
  console.log(`✅ Health Check: http://localhost:${PORT}/health`);
  console.log(`📚 Endpoints available for: Assignment, Long Answer, Short Answer, Quiz, Grammar Fix, Chat Tutor`);
  console.log(`🔒 Environment: ${process.env.NODE_ENV || 'development'}`);
});

// Export for testing
module.exports = { app, server, generateAIResponse };
