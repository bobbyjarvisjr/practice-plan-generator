const express = require('express');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');
const { Resend } = require('resend');
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

const resend = new Resend(process.env.RESEND_API_KEY);

const MASTERCLASS_LIBRARY_URL = 'https://www.bobbyjarvisjr.com/collections/all';
const FROM_EMAIL = 'jarvis@bobbyjarvisjr.com';
const RESEND_AUDIENCE_ID = '75f227cf-4d8c-429a-8fcf-ee71f69c70fd';

async function saveLead(name, email) {
  try {
    const firstName = name.split(' ')[0];
    const lastName = name.split(' ').slice(1).join(' ') || '';
    await resend.contacts.create({
      email: email,
      firstName: firstName,
      lastName: lastName,
      unsubscribed: false,
      audienceId: RESEND_AUDIENCE_ID,
    });
  } catch (err) {
    console.error('Failed to save contact to Resend:', err.message);
  }
}

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

function buildEmailHTML(name, planHTML) {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: Georgia, serif; background: #f5f5f0; margin: 0; padding: 20px; color: #2c2c2c; }
    .container { max-width: 680px; margin: 0 auto; background: #fff; padding: 40px; border-radius: 4px; }
    h1 { color: #1a472a; font-size: 24px; margin-bottom: 4px; }
    h2 { color: #1a472a; font-size: 20px; margin-top: 32px; }
    h3 { color: #2c5f3f; font-size: 16px; margin-bottom: 4px; }
    .song-recommendation { background: #f9f9f6; border-left: 3px solid #2c5f3f; padding: 16px 20px; margin: 12px 0; border-radius: 0 4px 4px 0; }
    .masterclass-link { color: #2c5f3f; font-weight: bold; }
    .promo-box { background: #f0f7f2; border: 2px solid #1a472a; border-radius: 6px; padding: 20px 24px; margin: 24px 0; }
    .promo-box p { margin: 0; font-size: 14px; line-height: 1.7; }
    p { line-height: 1.7; }
    .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #eee; font-size: 13px; color: #888; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Your Guitar Practice Plan</h1>
    <p>Hey ${name}, here's your personalised practice plan. If you need more help with what and how to practice, make sure you come along to my free live masterclass below — then crack on with the plan underneath.</p>

    <div class="promo-box">
      <p><strong>🎸 FREE Live Masterclass — What To Practice</strong><br>
      March 28th &bull; 6pm UK / 1pm Eastern / 10am Pacific<br><br>
      Make sure to register now as there are limited spaces.<br><br>
      <a href="https://us06web.zoom.us/webinar/register/WN_dAd-o12YRrOIsVlJEitAfw" style="color:#1a472a;font-weight:bold;">👉 Register free here</a></p>
    </div>

    ${planHTML}

    <div class="footer">
      <p>Questions? Head to <a href="https://www.bobbyjarvisjr.com" style="color:#2c5f3f;">bobbyjarvisjr.com</a> to explore the full masterclass library.</p>
    </div>
  </div>
</body>
</html>`.trim();
}

app.post('/api/generate-plan', async function(req, res) {
  try {
    var body = req.body;
    var name = (body.name || '').trim();
    var email = (body.email || '').trim();

    if (!name || !email) {
      return res.status(400).json({ error: 'Name and email are required' });
    }

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
      '- When a song has [HAS MASTERCLASS: X], say: "This is covered in my <strong>X</strong> masterclass." and add: <a href="' + MASTERCLASS_LIBRARY_URL + '" target="_blank" class="masterclass-link">View Masterclass Library</a>\n' +
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

    // Save to Resend Audience and send email in parallel
    await Promise.all([
      saveLead(name, email),
      resend.emails.send({
        from: FROM_EMAIL,
        to: email,
        subject: 'Your Personalised Guitar Practice Plan',
        html: buildEmailHTML(name, planText)
      })
    ]);

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
});
