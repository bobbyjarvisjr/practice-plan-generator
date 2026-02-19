const express = require('express');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

// Load curriculum data
const curriculumData = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'curriculum_data.json'), 'utf-8')
);

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Helper function to get songs by belt level (e.g. "Foundation" matches "Foundation 1", "Foundation 2", "Foundation 3")
function getSongsByBelt(belt) {
  return curriculumData.filter(song => song.difficulty_level.startsWith(belt));
}

// Build curriculum context for Claude
function buildCurriculumContext() {
  const belts = ['Foundation', 'Developing', 'Competent', 'Advanced', 'Master'];

  let context = `# CURRICULUM DATABASE\n\n`;
  context += `You have access to ${curriculumData.length} songs organized by difficulty level.\n`;
  context += `Difficulty uses a belt system: Foundation (easiest) → Developing → Competent → Advanced → Master (hardest).\n`;
  context += `Each belt has sub-levels 1-3 (1=easier end, 3=harder end of that belt).\n\n`;

  for (const belt of belts) {
    const songs = getSongsByBelt(belt);
    context += `## ${belt} Level (${songs.length} songs)\n`;
    songs.forEach(song => {
      let songLine = `- **${song.title}** by ${song.artist} [${song.difficulty_level}]`;
      if (song.skill_category) songLine += ` | Skill: ${song.skill_category}`;
      if (song.secondary_skill_category) songLine += ` + ${song.secondary_skill_category}`;
      if (song.existing_masterclass) songLine += ` | [COURSE: ${song.existing_masterclass}]`;
      if (song.potential_masterclass) songLine += ` | [SUPPORTS: ${song.potential_masterclass}]`;
      context += songLine + '\n';
    });
    context += '\n';
  }

  return context;
}

// Main API endpoint
app.post('/api/generate-plan', async (req, res) => {
  try {
    const { scales, triads, chords, arpeggios, navigation, technique, struggles } = req.body;

    // Build assessment summary
    const assessment = {
      scales: scales || {},
      triads: triads || {},
      chords: chords || {},
      arpeggios: arpeggios || {},
      navigation: navigation || {},
      technique: technique || {},
      struggles: struggles || []
    };

    // Calculate weakest areas
    const allScores = {
      ...assessment.scales,
      ...assessment.triads,
      ...assessment.chords,
      ...assessment.arpeggios,
      ...assessment.navigation,
      ...assessment.technique
    };

    const avgScore = Object.values(allScores).reduce((a, b) => a + b, 0) / Object.keys(allScores).length || 0;
    const weakAreas = Object.entries(allScores)
      .filter(([key, val]) => val <= 2)
      .map(([key]) => key);

    // Build the system prompt
    const systemPrompt = `You are an experienced guitar teacher creating a personalized practice plan for a student.

Your response has two parts:

PART 1 - ASSESSMENT (3-4 paragraphs):
- Give an honest overview of where they're at based on their scores
- Identify their 2-3 most important areas to develop
- Explain WHY these areas matter for their playing
- Be direct and specific, not generic

PART 2 - SONG RECOMMENDATIONS (exactly 5-7 songs):
- Pick songs that directly address their weak areas
- Match difficulty to their level using the difficulty_level field (e.g. "Competent 2") - don't jump too far ahead
- For each song: one clear sentence on why it helps, plus mention the masterclass if one exists
- Order from most accessible to most challenging
- Where a song has a secondary_skill_category, mention it briefly

Rules:
- Recommend EXACTLY 5-7 songs. Not more.
- If a song has [COURSE: X] - say "covered in X"
- If a song has [SUPPORTS: X] - say "X masterclass would complement this"
- Tone: direct, encouraging, British guitar teacher. No corporate speak. No waffle.
- Be concise. Every sentence should earn its place.`;

    // Build the user prompt
    const curriculumContext = buildCurriculumContext();
    
    const assessmentSummary = `
ASSESSMENT RESULTS:
- Average technical level: ${(avgScore / 5 * 100).toFixed(0)}%
- Main weak areas: ${weakAreas.length > 0 ? weakAreas.slice(0, 5).join(', ') : 'Overall development needed'}
- Self-reported struggles: ${assessment.struggles.length > 0 ? assessment.struggles.join(', ') : 'None specified'}

Detailed scores:
${JSON.stringify(assessment, null, 2)}

${curriculumContext}

TASK: 
1. Write a detailed assessment of this player (3-4 paragraphs) covering their current level, what's holding them back, and what to prioritise
2. Recommend exactly 5-7 songs from the curriculum that will move the needle on their weakest areas
3. For each song: one clear reason why it helps, difficulty level, and any relevant masterclass

Format as clean HTML for embedding in a web page. Use <h2>, <h3>, <p>, <ul>, <li> tags. Wrap each song in <div class="song-recommendation"> tags. Keep it tight - no padding, no repetition.

    // Call Claude API
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 2500,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: assessmentSummary
        }
      ]
    });

    // Extract and clean the response
    let planText = message.content[0].type === 'text' ? message.content[0].text : '';
    
    // Clean up any markdown code fence artifacts
    planText = planText.replace(/^```html\n?/i, '').replace(/\n?```$/i, '').trim();
    planText = planText.replace(/^```\n?/i, '').replace(/\n?```$/i, '').trim();
    planText = planText.replace(/^["']html["']\n?/i, '').trim();

    // Return as JSON
    res.json({
      plan: planText
    });

  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({
      error: error.message || 'Failed to generate practice plan'
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Serve index.html for root path
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`✓ Server running on http://localhost:${PORT}`);
  console.log(`✓ Curriculum loaded: ${curriculumData.length} songs`);
  console.log(`✓ API endpoint: POST /api/generate-plan`);
  console.log(`✓ Model: Claude Sonnet 4.5`);
});
