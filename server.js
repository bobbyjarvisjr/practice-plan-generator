const express = require('express');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

const curriculumData = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'curriculum_data.json'), 'utf-8')
);

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

function getSongsByBelt(belt) {
  return curriculumData.filter(function(song) {
    return song.difficulty_level.startsWith(belt);
  });
}

function buildCurriculumContext() {
  var belts = ['Foundation', 'Developing', 'Competent', 'Advanced', 'Master'];
  var context = '# CURRICULUM DATABASE\n\n';
  context += 'You have access to ' + curriculumData.length + ' songs organized by difficulty level.\n';
  context += 'Difficulty uses a belt system: Foundation (easiest) to Developing to Competent to Advanced to Master (hardest).\n';
  context += 'Each belt has sub-levels 1-3 (1=easier end, 3=harder end of that belt).\n\n';

  for (var i = 0; i < belts.length; i++) {
    var belt = belts[i];
    var songs = getSongsByBelt(belt);
    context += '## ' + belt + ' Level (' + songs.length + ' songs)\n';
    songs.forEach(function(song) {
      var songLine = '- **' + song.title + '** by ' + song.artist + ' [' + song.difficulty_level + ']';
      if (song.skill_category) songLine += ' | Skill: ' + song.skill_category;
      if (song.secondary_skill_category) songLine += ' + ' + song.secondary_skill_category;
      if (song.existing_masterclass) songLine += ' | [COURSE: ' + song.existing_masterclass + ']';
      if (song.potential_masterclass) songLine += ' | [SUPPORTS: ' + song.potential_masterclass + ']';
      context += songLine + '\n';
    });
    context += '\n';
  }
  return context;
}

app.post('/api/generate-plan', async function(req, res) {
  try {
    var body = req.body;
    var assessment = {
      scales: body.scales || {},
      triads: body.triads || {},
      chords: body.chords || {},
      arpeggios: body.arpeggios || {},
      navigation: body.navigation || {},
      technique: body.technique || {},
      struggles: body.struggles || []
    };

    var allScores = Object.assign({},
      assessment.scales,
      assessment.triads,
      assessment.chords,
      assessment.arpeggios,
      assessment.navigation,
      assessment.technique
    );

    var scoreValues = Object.values(allScores);
    var avgScore = scoreValues.length > 0
      ? scoreValues.reduce(function(a, b) { return a + b; }, 0) / scoreValues.length
      : 0;

    var weakAreas = Object.entries(allScores)
      .filter(function(entry) { return entry[1] <= 2; })
      .map(function(entry) { return entry[0]; });

    var systemPrompt = 'You are an experienced guitar teacher creating a personalized practice plan for a student.\n\n' +
      'Your response has two parts:\n\n' +
      'PART 1 - ASSESSMENT (3-4 paragraphs):\n' +
      '- Give an honest overview of where they are at based on their scores\n' +
      '- Identify their 2-3 most important areas to develop\n' +
      '- Explain WHY these areas matter for their playing\n' +
      '- Be direct and specific, not generic\n\n' +
      'PART 2 - SONG RECOMMENDATIONS (exactly 5-7 songs):\n' +
      '- Pick songs that directly address their weak areas\n' +
      '- Match difficulty to their level using the difficulty_level field (e.g. "Competent 2") - do not jump too far ahead\n' +
      '- For each song: one clear sentence on why it helps, difficulty level, and any relevant masterclass\n' +
      '- Order from most accessible to most challenging\n' +
      '- Where a song has a secondary_skill_category, mention it briefly\n\n' +
      'Rules:\n' +
      '- Recommend EXACTLY 5-7 songs. Not more.\n' +
      '- If a song has [COURSE: X] - say "covered in X"\n' +
      '- If a song has [SUPPORTS: X] - say "X masterclass would complement this"\n' +
      '- Tone: direct, encouraging, British guitar teacher. No corporate speak. No waffle.\n' +
      '- Be concise. Every sentence should earn its place.';

    var curriculumContext = buildCurriculumContext();

    var assessmentSummary = '\nASSESSMENT RESULTS:\n' +
      '- Average technical level: ' + (avgScore / 5 * 100).toFixed(0) + '%\n' +
      '- Main weak areas: ' + (weakAreas.length > 0 ? weakAreas.slice(0, 5).join(', ') : 'Overall development needed') + '\n' +
      '- Self-reported struggles: ' + (assessment.struggles.length > 0 ? assessment.struggles.join(', ') : 'None specified') + '\n\n' +
      'Detailed scores:\n' +
      JSON.stringify(assessment, null, 2) + '\n\n' +
      curriculumContext + '\n\n' +
      'TASK:\n' +
      '1. Write a detailed assessment of this player (3-4 paragraphs) covering their current level, what is holding them back, and what to prioritise\n' +
      '2. Recommend exactly 5-7 songs from the curriculum that will move the needle on their weakest areas\n' +
      '3. For each song: one clear reason why it helps, difficulty level, and any relevant masterclass\n\n' +
      'Format as clean HTML for embedding in a web page. Use <h2>, <h3>, <p>, <ul>, <li> tags. Wrap each song in <div class="song-recommendation"> tags. Keep it tight - no padding, no repetition.';

    var message = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 2500,
      system: systemPrompt,
      messages: [{ role: 'user', content: assessmentSummary }]
    });

    var planText = message.content[0].type === 'text' ? message.content[0].text : '';

    // Strip markdown code fences if present
    planText = planText.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '').trim();

    res.json({ plan: planText });

  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message || 'Failed to generate practice plan' });
  }
});

app.get('/health', function(req, res) {
  res.json({ status: 'ok' });
});

app.get('/', function(req, res) {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, function() {
  console.log('Server running on port ' + PORT);
  console.log('Curriculum loaded: ' + curriculumData.length + ' songs');
  console.log('API endpoint: POST /api/generate-plan');
});
