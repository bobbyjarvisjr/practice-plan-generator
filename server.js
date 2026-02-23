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

function determinePlayerLevel(allScores) {
  var scoreValues = Object.values(allScores);
  if (scoreValues.length === 0) return 'beginner';
  var avg = scoreValues.reduce(function(a, b) { return a + b; }, 0) / scoreValues.length;
  if (avg <= 2) return 'beginner';
  if (avg <= 4) return 'intermediate';
  return 'advanced';
}

function buildCurriculumContext(playerLevel) {
  var beltsToInclude;

  if (playerLevel === 'beginner') {
    beltsToInclude = ['Foundation', 'Developing'];
  } else if (playerLevel === 'intermediate') {
    beltsToInclude = ['Developing', 'Competent', 'Advanced'];
  } else {
    beltsToInclude = ['Competent', 'Advanced', 'Master'];
  }

  var context = '# CURRICULUM DATABASE\n\n';
  context += 'Songs organised by difficulty: Foundation (easiest) through to Master (hardest). Each belt has sub-levels 1-3.\n';
  context += 'Songs marked [HAS MASTERCLASS] have a paid masterclass available - PRIORITISE these where they fit.\n\n';

  for (var i = 0; i < beltsToInclude.length; i++) {
    var belt = beltsToInclude[i];
    var songs = getSongsByBelt(belt);

    // Sort masterclass songs to the top
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

    var avgPercent = (avgScore / 6 * 100).toFixed(0);

    var weakAreas = Object.entries(allScores)
      .filter(function(entry) { return entry[1] <= 2; })
      .map(function(entry) { return entry[0]; });

    var playerLevel = determinePlayerLevel(allScores);
    var curriculumContext = buildCurriculumContext(playerLevel);

    var systemPrompt = 'You are J, an experienced British guitar teacher creating a personalised practice plan.\n\n' +

      'RATING SCALE (0-6):\n' +
      '0 = No knowledge at all\n' +
      '1 = Started learning but not using it yet\n' +
      '2 = Just starting to implement it\n' +
      '3 = Using it but still thinking about it\n' +
      '4 = Using it fairly confidently, occasionally get lost\n' +
      '5 = Using it confidently and fluently\n' +
      '6 = Mastered across the entire neck\n\n' +

      'MASTERCLASS PRIORITY RULE:\n' +
      'Prioritise songs marked [HAS MASTERCLASS] where they fit the student\'s weak areas and level. ' +
      'When recommending one, mention the masterclass by name and include this link: ' + MASTERCLASS_LIBRARY_URL + '\n' +
      'Format: "This is covered in the [masterclass name] — <a href="' + MASTERCLASS_LIBRARY_URL + '" target="_blank" class="masterclass-link">check it out in the masterclass library</a>."\n\n' +

      'YOUR RESPONSE HAS TWO PARTS THAT MUST BE DIRECTLY CONNECTED:\n\n' +

      'PART 1 — ASSESSMENT (3-4 paragraphs):\n' +
      '- Honest overview of where they are based on their scores\n' +
      '- Identify their 2-3 most important weak areas with clear reasons why they matter\n' +
      '- Be specific about what is holding them back\n\n' +

      'PART 2 — SONG RECOMMENDATIONS (exactly 5-7 songs):\n' +
      '- CRITICAL: Every single song must directly address one of the weak areas you identified in Part 1\n' +
      '- If you said triads are a priority, most songs must specifically work on triads\n' +
      '- If you said timing is a priority, include songs that specifically develop timing\n' +
      '- A reader must be able to look at each song and immediately see why it was chosen based on your assessment\n' +
      '- The assessment and song list must feel like one connected plan, not two separate things\n' +
      '- Prioritise masterclass songs first where they address the weak areas\n' +
      '- Match difficulty to their level — do not jump too far ahead\n' +
      '- Order from most accessible to most challenging\n\n' +

      'SONG TITLE FORMAT:\n' +
      '- Write song titles as: Song Title — Artist\n' +
      '- Do NOT include the difficulty level in the title\n' +
      '- Mention difficulty naturally in the description instead if needed\n\n' +

      'RULES:\n' +
      '- Recommend EXACTLY 5-7 songs. Not more, not less.\n' +
      '- Tone: direct, honest, encouraging. British. No waffle.\n' +
      '- Every sentence earns its place.\n' +
      '- Format as clean HTML using <h2>, <h3>, <p>, <ul>, <li> tags.\n' +
      '- Wrap each song in <div class="song-recommendation"> tags.\n' +
      '- Song title in <strong> tags inside the recommendation div.';

    var assessmentSummary =
      'PLAYER ASSESSMENT:\n' +
      '- Overall level: ' + playerLevel + ' (' + avgPercent + '% average, scale 0-6)\n' +
      '- Weak areas (scored 0-2): ' + (weakAreas.length > 0 ? weakAreas.slice(0, 5).join(', ') : 'No major weak areas') + '\n' +
      '- Self-reported struggles: ' + (assessment.struggles.length > 0 ? assessment.struggles.join(', ') : 'None specified') + '\n\n' +
      'Full scores (0-6 scale):\n' +
      JSON.stringify(assessment, null, 2) + '\n\n' +
      curriculumContext + '\n\n' +
      'Write the assessment identifying the 2-3 key priorities, then recommend exactly 5-7 songs that directly address those priorities. ' +
      'Every song must be chosen because it works on a weakness you named in the assessment. Masterclass songs first where they fit.';

    var message = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 2500,
      system: systemPrompt,
      messages: [{ role: 'user', content: assessmentSummary }]
    });

    var planText = message.content[0].type === 'text' ? message.content[0].text : '';

    planText = planText.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '').trim();

    res.json({ plan: planText });

  } catch (error) {
    console.error('Error generating plan:', error);
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
