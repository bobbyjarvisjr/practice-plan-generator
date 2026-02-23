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

function buildCurriculumContext() {
  var belts = ['Foundation', 'Developing', 'Competent', 'Advanced', 'Master'];
  var context = '# CURRICULUM DATABASE\n\n';
  context += 'You have access to ' + curriculumData.length + ' songs organized by difficulty level.\n';
  context += 'Difficulty uses a belt system: Foundation (easiest) to Developing to Competent to Advanced to Master (hardest).\n';
  context += 'Each belt has sub-levels 1-3 (1=easier end, 3=harder end of that belt).\n\n';

  for (var i = 0; i < belts.length; i++) {
    var belt = belts[i];
    var songs = getSongsByBelt(belt);

    // Sort masterclass songs to the top within each belt
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

    var systemPrompt = 'You are J, an experienced British guitar teacher creating a personalised practice plan.\n\n' +

      'RATING SCALE (0-6):\n' +
      '0 = No knowledge at all\n' +
      '1 = Started learning but not using it yet\n' +
      '2 = Just starting to implement it\n' +
      '3 = Using it but still thinking about it\n' +
      '4 = Using it fairly confidently, occasionally get lost\n' +
      '5 = Using it confidently and fluently\n' +
      '6 = Mastered across the entire neck\n\n' +

      'PART 1 - ASSESSMENT (3-4 paragraphs):\n' +
      '- Honest overview of where they are based on their scores\n' +
      '- Identify their 2-3 most important weak areas and why they matter\n' +
      '- Be direct and specific, not generic\n\n' +

      'PART 2 - SONG RECOMMENDATIONS (exactly 5-7 songs):\n' +
      '- Use the Skill: field in the curriculum to match songs to the weak areas you identified in Part 1\n' +
      '- If triads are weak, pick songs where Skill: Triads\n' +
      '- If major pentatonic is weak, pick songs where Skill: Major Pentatonic\n' +
      '- The Skill: field is your PRIMARY filter. Difficulty level is secondary.\n' +
      '- Every song must directly address a weak area you named in your assessment\n' +
      '- Do not jump too far ahead on difficulty\n' +
      '- Order from most accessible to most challenging\n\n' +

      'MASTERCLASS RULES:\n' +
      '- Prioritise songs marked [HAS MASTERCLASS] where they match the weak areas\n' +
      '- When a song has [HAS MASTERCLASS: X], say: "This is covered in my X masterclass." and add: <a href="' + MASTERCLASS_LIBRARY_URL + '" target="_blank" class="masterclass-link">View Masterclass Library</a>\n' +
      '- ONLY use the exact masterclass name from the [HAS MASTERCLASS: X] tag — never invent or guess a masterclass name\n' +
      '- If a song has no [HAS MASTERCLASS] tag, do not mention a masterclass at all\n\n' +

      'SONG TITLE FORMAT: Song Title — Artist (no difficulty label in the title)\n\n' +

      'FORMAT RULES:\n' +
      '- Recommend EXACTLY 5-7 songs. Not more, not less.\n' +
      '- Tone: direct, honest, encouraging. British. No waffle.\n' +
      '- Clean HTML only: <h2>, <h3>, <p>, <ul>, <li> tags\n' +
      '- Wrap each song in <div class="song-recommendation"> tags\n' +
      '- Song title in <strong> tags';

    var curriculumContext = buildCurriculumContext();

    var assessmentSummary =
      'ASSESSMENT RESULTS:\n' +
      '- Average technical level: ' + (avgScore / 6 * 100).toFixed(0) + '%\n' +
      '- Main weak areas (scored 0-2): ' + (weakAreas.length > 0 ? weakAreas.slice(0, 5).join(', ') : 'Overall development needed') + '\n' +
      '- Self-reported struggles: ' + (assessment.struggles.length > 0 ? assessment.struggles.join(', ') : 'None specified') + '\n\n' +
      'Detailed scores (0-6 scale):\n' +
      JSON.stringify(assessment, null, 2) + '\n\n' +
      curriculumContext + '\n\n' +
      'TASK:\n' +
      '1. Write the assessment identifying 2-3 key weak areas\n' +
      '2. Recommend exactly 5-7 songs - use the Skill: field to match songs directly to the weak areas you named\n' +
      '3. Every song must justify itself against a specific weakness from your assessment\n' +
      '4. For any song with [HAS MASTERCLASS: X], use that exact name and include the library link\n' +
      '5. Never invent a masterclass name\n\n' +
      'Format as clean HTML. Use <h2>, <h3>, <p>, <ul>, <li> tags. Wrap each song in <div class="song-recommendation"> tags.';

    var message = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 2500,
      system: systemPrompt,
      messages: [{ role: 'user', content: assessmentSummary }]
    });

    var planText = message.content[0].type === 'text' ? message.content[0].text : '';
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
