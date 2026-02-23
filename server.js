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

// Maps assessment field names to curriculum skill_category values
const SKILL_MAP = {
  minor_pentatonic:       ['Minor Pentatonic', 'Pentatonic Add 9', 'Mixing Pentatonics'],
  major_pentatonic:       ['Major Pentatonic', 'Mixing Pentatonics'],
  major_scale:            ['Major Scale / Diatonic'],
  bar_chords:             ['Beginner Fundamentals', 'Rhythm & Funk'],
  major_triads:           ['Triads'],
  minor_triads:           ['Triads'],
  diminished_triads:      ['Triads'],
  major_chords:           ['Extended Chords', 'Triads'],
  minor_chords:           ['Extended Chords', 'Triads'],
  maj7_chords:            ['Extended Chords'],
  min7_chords:            ['Extended Chords'],
  dom7_chords:            ['Extended Chords'],
  dim_chords:             ['Extended Chords'],
  harmonized_major_scale: ['Major Scale / Diatonic', 'Following the Changes'],
  chord_targeting:        ['Following the Changes', 'Arpeggios'],
  slash_chords:           ['Spread Triads', 'Extended Chords'],
  major_arps:             ['Arpeggios'],
  minor_arps:             ['Arpeggios'],
  maj7_arps:              ['Arpeggios', 'Extended Chords'],
  min7_arps:              ['Arpeggios', 'Extended Chords'],
  dom7_arps:              ['Arpeggios', 'Extended Chords'],
  dim_arps:               ['Arpeggios'],
  root_notes:             ['Beginner Fundamentals', 'Major Scale / Diatonic'],
  same_note:              ['Beginner Fundamentals', 'Major Scale / Diatonic'],
  timing:                 ['Rhythm & Funk'],
  pocket:                 ['Rhythm & Funk', 'Blues'],
  bending_accuracy:       ['Minor Pentatonic', 'Blues', 'Major Pentatonic'],
  bending_phrasing:       ['Blues', 'Minor Pentatonic', 'Mixing Pentatonics'],
  vibrato_control:        ['Blues', 'Minor Pentatonic'],
  vibrato_musicality:     ['Blues', 'Mixing Pentatonics'],
  accuracy:               ['Minor Pentatonic', 'Major Pentatonic'],
  picking:                ['Beginner Fundamentals', 'Rhythm & Funk'],
  muting:                 ['Rhythm & Funk', 'Beginner Fundamentals'],
  modes:                  ['Modes'],
};

const BELT_ORDER = ['Foundation', 'Developing', 'Competent', 'Advanced', 'Master'];

function getBeltIndex(difficultyLevel) {
  for (var i = 0; i < BELT_ORDER.length; i++) {
    if (difficultyLevel.startsWith(BELT_ORDER[i])) return i;
  }
  return 0;
}

function determinePlayerLevel(allScores) {
  var scoreValues = Object.values(allScores);
  if (scoreValues.length === 0) return 1; // index into BELT_ORDER
  var avg = scoreValues.reduce(function(a, b) { return a + b; }, 0) / scoreValues.length;
  if (avg <= 2) return 0; // Foundation
  if (avg <= 3.5) return 1; // Developing
  if (avg <= 5) return 2; // Competent
  return 3; // Advanced
}

function getRelevantSongs(weakAreaFields, playerBeltIndex) {
  // Get all skill categories for weak areas
  var relevantCategories = [];
  weakAreaFields.forEach(function(field) {
    var cats = SKILL_MAP[field] || [];
    cats.forEach(function(cat) {
      if (relevantCategories.indexOf(cat) === -1) {
        relevantCategories.push(cat);
      }
    });
  });

  // Filter songs by skill category match, within 1 belt of player level
  var filtered = curriculumData.filter(function(song) {
    var beltIndex = getBeltIndex(song.difficulty_level);
    var withinRange = beltIndex >= Math.max(0, playerBeltIndex - 1) &&
                      beltIndex <= playerBeltIndex + 1;
    var skillMatch = relevantCategories.indexOf(song.skill_category) !== -1 ||
                     relevantCategories.indexOf(song.secondary_skill_category) !== -1;
    return withinRange && skillMatch;
  });

  // Sort: masterclass songs first, then by difficulty
  filtered.sort(function(a, b) {
    var aHas = a.existing_masterclass ? 1 : 0;
    var bHas = b.existing_masterclass ? 1 : 0;
    if (bHas !== aHas) return bHas - aHas;
    return getBeltIndex(a.difficulty_level) - getBeltIndex(b.difficulty_level);
  });

  return filtered;
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

    // Get weak areas - scored 2 or below
    var weakAreaFields = Object.entries(allScores)
      .filter(function(entry) { return entry[1] <= 2; })
      .map(function(entry) { return entry[0]; });

    // If no weak areas, use lowest scoring fields
    if (weakAreaFields.length === 0) {
      weakAreaFields = Object.entries(allScores)
        .sort(function(a, b) { return a[1] - b[1]; })
        .slice(0, 3)
        .map(function(entry) { return entry[0]; });
    }

    var playerBeltIndex = determinePlayerLevel(allScores);

    // Pre-filter songs to only those relevant to weak areas
    var relevantSongs = getRelevantSongs(weakAreaFields, playerBeltIndex);

    // Build a lean curriculum context with only relevant songs
    var relevantContext = '# RELEVANT SONGS FOR THIS STUDENT\n\n';
    relevantContext += 'These songs have been pre-selected because they match this student\'s weak areas and level.\n';
    relevantContext += 'Songs marked [HAS MASTERCLASS] should be prioritised.\n\n';

    if (relevantSongs.length === 0) {
      relevantContext += 'No exact matches found - broaden selection from full curriculum.\n';
    } else {
      relevantSongs.forEach(function(song) {
        var line = '- **' + song.title + '** by ' + song.artist;
        line += ' [' + song.difficulty_level + ']';
        line += ' | Skill: ' + song.skill_category;
        if (song.secondary_skill_category) line += ' + ' + song.secondary_skill_category;
        if (song.section) line += ' | Section: ' + song.section;
        if (song.existing_masterclass) line += ' | [HAS MASTERCLASS: ' + song.existing_masterclass + ']';
        relevantContext += line + '\n';
      });
    }

    var systemPrompt = 'You are J, an experienced British guitar teacher creating a personalised practice plan.\n\n' +

      'RATING SCALE (0-6):\n' +
      '0 = No knowledge at all\n' +
      '1 = Started learning but not using it yet\n' +
      '2 = Just starting to implement it\n' +
      '3 = Using it but still thinking about it\n' +
      '4 = Using it fairly confidently, occasionally get lost\n' +
      '5 = Using it confidently and fluently\n' +
      '6 = Mastered across the entire neck\n\n' +

      'MASTERCLASS RULE:\n' +
      'When recommending a song marked [HAS MASTERCLASS], always name the masterclass and include: ' +
      '<a href="' + MASTERCLASS_LIBRARY_URL + '" target="_blank" class="masterclass-link">View Masterclass Library</a>\n\n' +

      'PART 1 — ASSESSMENT (3-4 paragraphs):\n' +
      '- Honest overview based on scores\n' +
      '- Identify 2-3 key weak areas and why they matter\n' +
      '- Direct, specific, no generic waffle\n\n' +

      'PART 2 — SONG RECOMMENDATIONS (exactly 5-7 songs):\n' +
      '- You MUST pick from the pre-selected song list provided. These have already been filtered to match the student\'s weak areas.\n' +
      '- Masterclass songs first\n' +
      '- For each song: explain specifically how it addresses a weak area from your assessment\n' +
      '- Song title format: Song Title — Artist (no difficulty label in the title)\n' +
      '- Mention difficulty naturally in the description if relevant\n' +
      '- Order from most accessible to most challenging\n\n' +

      'RULES:\n' +
      '- Exactly 5-7 songs. No more, no less.\n' +
      '- British tone. Direct. Encouraging. No waffle.\n' +
      '- Format as clean HTML: <h2>, <h3>, <p>, <ul>, <li> tags.\n' +
      '- Wrap each song in <div class="song-recommendation"> tags.\n' +
      '- Song title in <strong> tags.';

    var assessmentSummary =
      'STUDENT SCORES (0-6 scale):\n' +
      JSON.stringify(assessment, null, 2) + '\n\n' +
      '- Average: ' + avgPercent + '%\n' +
      '- Weak areas: ' + (weakAreaFields.length > 0 ? weakAreaFields.join(', ') : 'none') + '\n' +
      '- Self-reported struggles: ' + (assessment.struggles.length > 0 ? assessment.struggles.join(', ') : 'none') + '\n\n' +
      relevantContext + '\n\n' +
      'Write the assessment, then pick exactly 5-7 songs from the pre-selected list above. ' +
      'Every song must directly address a weak area from your assessment. Masterclass songs first.';

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
