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

// Helper function to get songs by difficulty
function getSongsByDifficulty(difficulty) {
  return curriculumData.filter(song => song.difficulty_level === difficulty);
}

// Build curriculum context for Claude
function buildCurriculumContext() {
  const byDifficulty = {
    Foundation: getSongsByDifficulty('Foundation'),
    Developing: getSongsByDifficulty('Developing'),
    Competent: getSongsByDifficulty('Competent'),
    Advanced: getSongsByDifficulty('Advanced'),
    Master: getSongsByDifficulty('Master'),
  };

  let context = `# CURRICULUM DATABASE\n\n`;
  context += `You have access to ${curriculumData.length} songs organized by difficulty level.\n\n`;

  for (const [difficulty, songs] of Object.entries(byDifficulty)) {
    context += `## ${difficulty} Level (${songs.length} songs)\n`;
    songs.forEach(song => {
      let songLine = `- **${song.title}** by ${song.artist}`;
      if (song.primary_skill) songLine += ` | Teaches: ${song.primary_skill}`;
      if (song.secondary_skills) songLine += ` | Also: ${song.secondary_skills}`;
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
    const systemPrompt = `You are an experienced guitar teacher creating a personalized practice plan.

Your approach:
- Be practical and direct
- Focus on specific areas of weakness
- Recommend songs that develop weak skills
- Reference masterclasses that teach relevant concepts
- Create a clear, actionable plan

When recommending songs:
1. If a song has an "Existing Masterclass" or "Teaches" note - mention it as "This is covered in [Masterclass Name]"
2. If a song has a "Supports" note - mention it as "[Masterclass Name] would really help with this"
3. Always explain WHY each song helps with their weak areas
4. Suggest songs at appropriate difficulty (near their level, not a huge jump)
5. Order recommendations from foundational to more advanced
6. Aim to recommend 10-15 specific songs that form a logical progression

Keep the tone conversational and encouraging, but practical. No corporate speak.`;

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

TASK: Create a personalized practice plan that:
1. Acknowledges their current level
2. Identifies the 3-4 most important skills to work on
3. Recommends 10-15 specific songs (with artist names) that will develop these skills
4. For each song, explain WHY it helps and which masterclass covers it (if applicable)
5. Suggests a rough order (what to tackle first, what comes next)
6. Keeps it practical and doable - not overwhelming

Format the response as clear, readable HTML that will be embedded in a web page. Use <h2>, <h3>, <p>, <ul>, <li> tags. Style any song recommendations in <div class="song-recommendation"> tags.

Start with a brief assessment, then lay out the recommendations.`;

    // Call Claude API with Sonnet model
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 2000,
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
