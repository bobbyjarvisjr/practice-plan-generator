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

const MASTERCLASS_LIBRARY_URL = 'https://www.bobbyjarvisjr.com/collections/all';

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

function getSongsByBelt(belt) {
  return curriculumData.filter(function(song) {
    return song.difficulty_level.startsWith(belt);
  });
}

function buildCurriculumContext(playerLevel) {
  // Determine which belt levels to include based on player level
  // This keeps the prompt lean and relevant
  var allBelts = ['Foundation', 'Developing', 'Competent', 'Advanced', 'Master'];
  var beltsToInclude;

  if (playerLevel === 'beginner') {
    beltsToInclude = ['Foundation', 'Developing'];
  } else if (playerLevel === 'intermediate') {
    beltsToInclude = ['Developing', 'Competent', 'Advanced'];
  } else if (playerLevel === 'advanced') {
    beltsToInclude = ['Competent', 'Advanced', 'Master'];
  } else {
    beltsToInclude = allBelts;
  }

  var context = '# CURRICULUM DATABASE\n\n';
  context += 'Songs are organized by difficulty: Foundation (easiest) → Developing → Competent → Advanced → Master (hardest).\n';
  context += 'Each belt has sub-levels 1-3.\n';
  context += 'Songs marked [HAS MASTERCLASS] have a paid masterclass available - PRIORITISE these in recommendations.\n';
  context += 'Songs without a masterclass tag are still valid curriculum songs.\n\n';

  for (var i = 0; i < beltsToInclude.length; i++) {
    var belt = beltsToInclude[i];
    var songs = getSongsByBelt(belt);

    // Sort: masterclass songs first, then others
    songs.sort(function(a, b) {
      var aHas = a.existing_masterclass ? 1 : 0;
      var bHas = b.existing_masterclass ? 1 : 0;
      return bHas - aHas;
    });

    context += '## ' + belt + ' Level (' + songs.length + ' songs)\n';
    songs.forEach(function(song) {
      var songLine = '- **' + song.title + '** by ' + song.artist + ' [' + song.difficulty_level + ']';
      if (song.skill_category) songLine += ' | Skill: ' + song.skill_category;
      if (song.secondary_skill_category) songLine += ' + ' + song.secondary_skill_category;
      if (song.section) songLine += ' | Section: ' + song.section;
      if (song.existing_masterclass) songLine += ' | [HAS MASTERCLASS: ' + song.existing_masterclass + ']';
      context += songLine + '\n';
    });
    context += '\n';
  }
  return context;
}

function determinePlayerLevel(allScores) {
  var scoreValues = Object.values(allScores);
  if (scoreValues.length === 0) return 'beginner';
  var avg = scoreValues.reduce(function(a, b) { return a + b; }, 0) / scoreValues.length;
  // Scale is now 0-6
  if (avg <= 2) return 'beginner';
  if (avg <= 4) return 'intermediate';
  return 'advanced';
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

    // Scale is 0-6, so divide by 6 for percentage
    var avgPercent = (avgScore / 6 * 100).toFixed(0);

    var weakAreas = Object.entries(allScores)
      .filter(function(entry) { return entry[1] <= 2; })
      .map(function(entry) { return entry[0]; });

    var playerLevel = determinePlayerLevel(allScores);

    var systemPrompt = 'You are J, an experienced British guitar teacher creating a personalised practice plan.\n\n' +

      'RATING SCALE REFERENCE (so you interpret scores correctly):\n' +
      '0 = No knowledge at all\n' +
      '1 = Started learning but not using it yet\n' +
      '2 = Just starting to implement it\n' +
      '3 = Using it but still thinking about it\n' +
      '4 = Using it fairly confidently, occasionally get lost\n' +
      '5 = Using it confidently and fluently\n' +
      '6 = Mastered across the entire neck\n\n' +

      'MASTERCLASS PRIORITY RULE:\n' +
      'Songs marked [HAS MASTERCLASS] should be prioritised in your recommendations where they match the student\'s level and needs. ' +
      'When recommending one of these songs, always include a clear call-to-action: mention the masterclass by name and include this link: ' + MASTERCLASS_LIBRARY_URL + '\n' +
      'Format it like: "This is covered in the [masterclass name] — available in the complete masterclass library at ' + MASTERCLASS_LIBRARY_URL + '"\n\n' +

      'SONG VARIETY RULE:\n' +
      'Draw from the full range of songs in the curriculum. Do not default to well-known or obvious choices. ' +
      'Pick the songs that genuinely best fit this specific student\'s gaps, even if they are less well-known.\n\n' +

      'Your response has two parts:\n\n' +

      'PART 1 - ASSESSMENT (3-4 paragraphs):\n' +
      '- Give an honest overview of where they are based on their scores\n' +
      '- Identify their 2-3 most important areas to develop\n' +
      '- Explain WHY these areas matter for their playing\n' +
      '- Be direct and specific, not generic\n\n' +

      'PART 2 - SONG RECOMMENDATIONS (exactly 5-7 songs):\n' +
      '- Prioritise songs with a masterclass attached first, then other curriculum songs\n' +
      '- Match difficulty carefully to their level — do not jump too far ahead\n' +
      '- For each song: one clear sentence on why it helps them specifically, the difficulty level, section if relevant, and any masterclass call-to-action\n' +
      '- Order from most accessible to most challenging\n\n' +

      'Rules:\n' +
      '- Recommend EXACTLY 5-7 songs. Not more, not less.\n' +
      '- Tone: direct, honest, encouraging. British. No corporate waffle.\n' +
      '- Be concise. Every sentence earns its place.\n' +
      '- Format as clean HTML using <h2>, <h3>, <p>, <ul>, <li> tags.\n' +
      '- Wrap each song in <div class="song-recommendation"> tags.\n' +
      '- For masterclass call-to-actions use: <a href="' + MASTERCLASS_LIBRARY_URL + '" target="_blank" class="masterclass-link">View Masterclass Library</a>';

    // Only pass relevant curriculum sections based on player level
    var curriculumContext = buildCurriculumContext(playerLevel);

    var assessmentSummary = 'ASSESSMENT RESULTS:\n' +
      '- Overall level: ' + playerLevel + ' (' + avgPercent + '% average across answered questions)\n' +
      '- Main weak areas (scored 0-2): ' + (weakAreas.length > 0 ? weakAreas.slice(0, 5).join(', ') : 'No major weak areas identified') + '\n' +
      '- Self-reported struggles: ' + (assessment.struggles.length > 0 ? assessment.struggles.join(', ') : 'None specified') + '\n\n' +
      'Detailed scores (scale 0-6):\n' +
      JSON.stringify(assessment, null, 2) + '\n\n' +
      curriculumContext + '\n\n' +
      'TASK:\n' +
      '1. Write a detailed assessment of this player based on their scores\n' +
      '2. Recommend exactly 5-7 songs — masterclass songs first where they fit, then other curriculum songs\n' +
      '3. For any song with a masterclass, include the call-to-action with the library link\n' +
      '4. Keep it tight — no padding, no repetition';

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
