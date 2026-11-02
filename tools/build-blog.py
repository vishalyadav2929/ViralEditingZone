#!/usr/bin/env python3
"""Builds the static blog pages in site/blog/ (one shared layout, SEO meta + JSON-LD).

Run:  python3 tools/build-blog.py
The generated HTML is committed, so GitHub Pages serves it with no build step.
Only claim what the site really does: free, no watermark, no login, runs in the
browser, Hindi/Hinglish/30+ languages, 90 caption styles, thumbnail maker,
transparent / green-screen caption export.
"""
import html, json, os

SITE = 'https://brandbaazi.in'
OUT = os.path.join(os.path.dirname(__file__), '..', 'site', 'blog')
DATE = '2026-11-02'

POSTS = []


def post(slug, title, desc, h1, lead, body, faq, related):
    POSTS.append(dict(slug=slug, title=title, desc=desc, h1=h1, lead=lead, body=body, faq=faq, related=related))


CTA = '<p class="box"><b>Try it now — free, no watermark, no login:</b> <a class="cta" href="/">Open BrandBaazi Studio →</a></p>'

# ---------------------------------------------------------------------------------------------
post(
    'best-free-auto-caption-generator-no-watermark',
    'Best Free Auto Caption Generator for Video (No Watermark) — 2026',
    'Looking for the best free auto caption generator without watermark? Add viral animated captions to Reels, Shorts and YouTube in Hindi, Hinglish or English — no login, no watermark.',
    'Best free auto caption generator for video — without watermark',
    'Most "free" caption tools stamp a watermark on your video, lock the good styles behind a plan, or make you sign up first. Here is what to look for — and a tool that does it free.',
    '''
<h2>What makes an auto caption generator "the best"?</h2>
<p>For Reels, Shorts and YouTube, five things decide whether a caption tool is worth it:</p>
<ol>
  <li><b>No watermark</b> on the exported video — otherwise you can't post it on a brand page.</li>
  <li><b>Accurate speech-to-text</b> in the language you actually speak — including Hindi and Hinglish.</li>
  <li><b>Viral caption styles</b> — word-by-word highlight, pop, bounce, bold outlines, emoji.</li>
  <li><b>Easy editing</b> — fix a word, change timing, split or merge lines.</li>
  <li><b>Export quality</b> — the same resolution and sound as your original video.</li>
</ol>

<h2>BrandBaazi: a free auto caption generator built for Indian creators</h2>
<p><a href="/">BrandBaazi Studio</a> is a free auto caption generator that runs in your browser. Upload a video, pick the spoken language, and the captions appear with word-by-word timing. Then choose from <a href="/templates.html">90 animated caption styles</a> and export.</p>
<ul>
  <li><b>No watermark, no login, no plan.</b> The export is yours.</li>
  <li><b>Hindi, Hinglish, English and 30+ languages.</b> Hinglish captions are written in Roman script — the way people actually type.</li>
  <li><b>Your video stays on your device.</b> Captions are made in the browser, so nothing is uploaded to a server.</li>
  <li><b>Original-quality export</b> — or export only the captions on a transparent or green-screen background to use in Premiere Pro, DaVinci Resolve or any mobile editor.</li>
  <li><b>Extras:</b> cut silences, add text and sound effects, colour looks, and a <a href="/blog/free-youtube-thumbnail-maker.html">free thumbnail maker</a>.</li>
</ul>

<h2>How to auto-caption a video for free (3 steps)</h2>
<ol>
  <li>Open <a href="/">brandbaazi.in</a> and upload your video (MP4, MOV or WebM).</li>
  <li>Choose the spoken language — Hindi, Hinglish, English or another — and wait for the captions.</li>
  <li>Pick a viral style, fix any word by clicking it, and press <b>Export video</b>.</li>
</ol>
<p>Full walkthrough: <a href="/blog/how-to-add-auto-captions-to-video.html">how to add auto captions to any video</a>.</p>

<h2>Free vs paid caption tools — the honest trade-off</h2>
<p>Paid desktop editors give you a full timeline for long projects. For short-form content — Reels, Shorts, podcasts clips, talking-head videos — a free browser tool is faster: no install, no learning curve, and no watermark. The one limit to know: the first time you use it, the speech model downloads once (it is then cached), so a fast connection helps.</p>
''',
    [
        ('Is BrandBaazi really free without a watermark?', 'Yes. Captioning, editing and export are free and the exported video has no watermark. No account is needed.'),
        ('Which languages does the auto caption generator support?', 'Hindi, Hinglish (Hindi written in Roman letters), English and 30+ other languages including Bengali, Marathi, Tamil, Telugu, Gujarati, Kannada, Malayalam and Punjabi.'),
        ('Is my video uploaded to a server?', 'No. Speech-to-text, editing and export all run inside your browser, so the video never leaves your device.'),
        ('Does it work on mobile?', 'Yes, it works in the phone browser. On phones a lighter speech model is used so it does not run out of memory; a computer gives the most accurate Hindi captions.'),
    ],
    ['how-to-add-auto-captions-to-video', 'hindi-hinglish-caption-generator', 'auto-captions-for-instagram-reels-youtube-shorts'],
)

# ---------------------------------------------------------------------------------------------
post(
    'how-to-add-auto-captions-to-video',
    'How to Add Auto Captions to a Video (Free, Step by Step)',
    'Step-by-step: how to add auto captions to any video for free — upload, generate word-by-word captions, pick a viral style and export without watermark.',
    'How to add auto captions to a video — free, step by step',
    'Captions make people stop scrolling: most short videos are watched with the sound off. Here is the fastest free way to add accurate, animated captions.',
    '''
<h2>Step 1 — Upload your video</h2>
<p>Open <a href="/">BrandBaazi Studio</a> and drop in your video. MP4, MOV (iPhone) and WebM all work. The file is read by your browser; it is not uploaded anywhere.</p>

<h2>Step 2 — Choose the spoken language</h2>
<p>Select the language spoken in the video. For Hindi or Hinglish speech on a computer, the <b>Best for Hindi</b> model is chosen automatically for higher accuracy. You can switch to <i>Fast</i> or <i>Balanced</i> under <i>More options</i>.</p>
<p>Want captions in a different script? Pick the caption language: Hindi (Devanagari), Hinglish (Roman Hindi) or English.</p>

<h2>Step 3 — Let the captions generate</h2>
<p>The first time, the speech model downloads once and is then cached. After that, captions appear with word-by-word timing, so each word can light up exactly when it is spoken.</p>

<h2>Step 4 — Fix words and timing</h2>
<ul>
  <li>Click any word on the timeline to edit it.</li>
  <li>Use <b>Split</b> and merge to control how many words show at once.</li>
  <li>Press <b>🧹 Remove umm/uh</b> to clean filler words, and <b>Cut silences</b> to tighten the edit.</li>
</ul>

<h2>Step 5 — Pick a viral caption style</h2>
<p>Choose from <a href="/templates.html">90 animated styles</a> — pop, bounce, karaoke highlight, bold outline, emoji and more. Change font, size, colour, outline and position in the Captions tab.</p>

<h2>Step 6 — Export</h2>
<p>Press <b>Export video</b>. You can download:</p>
<ul>
  <li><b>Video with captions</b> burned in — original sound kept, no watermark.</li>
  <li><b>Captions only (transparent)</b> — a WebM with a real transparent background for Premiere Pro, DaVinci Resolve or After Effects.</li>
  <li><b>Captions only (green screen)</b> — for CapCut, InShot or VN: add it as an overlay and use Chroma Key.</li>
</ul>
''',
    [
        ('How do I add captions to a video automatically for free?', 'Upload the video to brandbaazi.in, choose the spoken language and the captions are generated automatically. Pick a style and export — free and without watermark.'),
        ('Can I edit the auto-generated captions?', 'Yes. Click any word to change it, adjust timing, split or merge lines, and remove filler words like umm and uh.'),
        ('Can I export only the captions to use in another editor?', 'Yes. Export captions only on a transparent background (WebM) or on a green screen (MP4) and place them over your video in any editor.'),
    ],
    ['best-free-auto-caption-generator-no-watermark', 'best-caption-fonts-for-reels', 'hindi-hinglish-caption-generator'],
)

# ---------------------------------------------------------------------------------------------
post(
    'hindi-hinglish-caption-generator',
    'Hindi & Hinglish Caption Generator for Videos — Free, No Watermark',
    'Free Hindi and Hinglish auto caption generator. Turn Hindi speech into Devanagari or Roman Hinglish captions for Reels and YouTube — no watermark.',
    'Hindi & Hinglish caption generator — free',
    'Most caption tools are built for English. If you speak Hindi — or mix Hindi and English like most Indian creators — you need a tool that writes it the way your audience reads it.',
    '''
<h2>Hindi captions vs Hinglish captions</h2>
<table>
  <tr><th></th><th>Hindi (Devanagari)</th><th>Hinglish (Roman)</th></tr>
  <tr><td>Example</td><td>यह ट्रिक सबको पता होनी चाहिए</td><td>ye trick sabko pata honi chahiye</td></tr>
  <tr><td>Best for</td><td>News, education, regional audiences</td><td>Reels, Shorts, young urban audiences</td></tr>
</table>
<p>BrandBaazi gives you both from the same Hindi speech — choose <b>Hindi</b> or <b>Hinglish</b> as the caption language. You can also translate the captions into English.</p>

<h2>How to make Hindi or Hinglish captions</h2>
<ol>
  <li>Open <a href="/">brandbaazi.in</a> and upload your video.</li>
  <li>Spoken language: <b>Hindi</b>. Caption language: <b>Hindi</b> or <b>Hinglish (Roman Hindi)</b>.</li>
  <li>On a computer, the <b>Best for Hindi</b> speech model is used automatically for the most accurate words.</li>
  <li>Fix any word by clicking it, pick a style and export — no watermark.</li>
</ol>

<h2>Tips for more accurate Hindi captions</h2>
<ul>
  <li>Record close to the mic and keep background music low while you speak.</li>
  <li>Use a computer for long videos — it runs the bigger Hindi model.</li>
  <li>Check names and English brand words once; they are the most common fixes.</li>
</ul>

<h2>Other Indian languages</h2>
<p>Bengali, Marathi, Tamil, Telugu, Gujarati, Kannada, Malayalam, Punjabi, Urdu, Nepali and more are supported, each with fonts that render the script correctly.</p>
''',
    [
        ('Can I get Hinglish captions from Hindi speech?', 'Yes. Choose Hindi as the spoken language and Hinglish (Roman Hindi) as the caption language.'),
        ('Is the Hindi caption generator free?', 'Yes — free, no login, and no watermark on the exported video.'),
        ('Which fonts support Hindi captions?', 'Styles use fonts that render Devanagari correctly, such as Noto Sans Devanagari, Yatra One and Rozha One.'),
    ],
    ['best-free-auto-caption-generator-no-watermark', 'how-to-add-auto-captions-to-video', 'auto-captions-for-instagram-reels-youtube-shorts'],
)

# ---------------------------------------------------------------------------------------------
post(
    'auto-captions-for-instagram-reels-youtube-shorts',
    'Auto Captions for Instagram Reels & YouTube Shorts — Free Generator',
    'Add viral auto captions to Instagram Reels and YouTube Shorts for free. 9:16 safe placement, word-by-word animation, Hindi and English, no watermark.',
    'Auto captions for Instagram Reels & YouTube Shorts',
    'On Reels and Shorts you have about one second to stop the scroll. Big, animated, word-by-word captions are one of the simplest ways to keep people watching.',
    '''
<h2>Why captions boost Reels and Shorts</h2>
<ul>
  <li>Many people watch with the sound off — captions carry the message anyway.</li>
  <li>Word-by-word highlights keep the eye moving, which helps watch time.</li>
  <li>Captions make your content clear for viewers who speak a different language.</li>
</ul>

<h2>Where to place captions on a 9:16 video</h2>
<p>Keep captions away from the bottom ~15% (likes, comments and the caption text sit there) and away from the right edge (action buttons). The middle third is the safest. In BrandBaazi, use the <b>Vertical position</b> slider in the Captions tab, or drag the caption on the preview.</p>

<h2>Make captions for a Reel in under a minute</h2>
<ol>
  <li>Upload the Reel or Short to <a href="/">brandbaazi.in</a>.</li>
  <li>Choose the spoken language; captions generate with word timing.</li>
  <li>Pick a trending style such as <i>Crazy</i>, <i>Spark</i> or a karaoke highlight.</li>
  <li>Export at 1080p — the size Instagram and YouTube Shorts display.</li>
</ol>

<h2>Turn one long video into several Shorts</h2>
<p>Have a podcast or vlog? Use <b>Long video → Shorts</b>: it finds strong moments, crops them to 9:16 and exports each one with captions.</p>

<h2>Sync captions to the beat</h2>
<p>Add music, press <b>Detect beats</b>, and turn on <b>Snap cuts to beats</b> so your cuts land on the beat.</p>
''',
    [
        ('What size should I export for Instagram Reels?', '1080×1920 (1080p, 9:16). BrandBaazi offers 1080p by default for vertical videos.'),
        ('Can I make Shorts from a long YouTube video?', 'Yes — upload the long video file and use Long video → Shorts to export several 9:16 clips with captions.'),
        ('Do captions work without sound?', 'Yes. Captions are burned into the video, so viewers read them even with the sound off.'),
    ],
    ['best-caption-fonts-for-reels', 'best-free-auto-caption-generator-no-watermark', 'free-youtube-thumbnail-maker'],
)

# ---------------------------------------------------------------------------------------------
post(
    'best-caption-fonts-for-reels',
    'Best Caption Fonts for Reels & Subtitles — Viral Instagram Font Names',
    'The best fonts for Reels captions and subtitles: Montserrat, Anton, Poppins, Bebas Neue, Luckiest Guy and more — plus Hindi fonts. Use them free in animated caption styles.',
    'Best caption fonts for Reels — viral Instagram font names',
    'Viral caption typography is mostly a few bold, readable fonts used with strong outlines and one highlight colour. Here are the fonts behind the styles creators copy most.',
    '''
<h2>The fonts behind viral captions</h2>
<table>
  <tr><th>Font</th><th>Look</th><th>Best for</th></tr>
  <tr><td><b>Montserrat</b> (Extra Bold)</td><td>Clean, wide, very readable</td><td>Talking-head, podcasts, business</td></tr>
  <tr><td><b>Anton</b> / <b>Bebas Neue</b></td><td>Tall, condensed, punchy</td><td>Hooks, motivation, sports</td></tr>
  <tr><td><b>Poppins</b></td><td>Round and friendly</td><td>Lifestyle, education</td></tr>
  <tr><td><b>Luckiest Guy</b> / <b>Bangers</b></td><td>Comic, playful</td><td>Memes, comedy, gaming</td></tr>
  <tr><td><b>Archivo Black</b></td><td>Heavy, modern</td><td>Brand videos, ads</td></tr>
  <tr><td><b>Playfair Display</b></td><td>Elegant serif</td><td>Fashion, aesthetic Reels, documentary</td></tr>
  <tr><td><b>Permanent Marker</b> / <b>Pacifico</b></td><td>Handwritten</td><td>Aesthetic, travel, vlogs</td></tr>
  <tr><td><b>Noto Sans Devanagari</b>, <b>Yatra One</b>, <b>Rozha One</b></td><td>Hindi script</td><td>Hindi captions</td></tr>
</table>

<h2>What makes caption typography go viral</h2>
<ul>
  <li><b>Bold weight</b> — thin fonts disappear on a phone.</li>
  <li><b>Thick outline or shadow</b> so text reads on any background.</li>
  <li><b>2–4 words at a time</b>, with the spoken word highlighted.</li>
  <li><b>One highlight colour</b> (yellow, green or your brand colour).</li>
  <li><b>UPPERCASE</b> for hooks, normal case for long talking videos.</li>
</ul>

<h2>Use these fonts free — no copy-paste needed</h2>
<p>"Copy and paste" Instagram fonts are Unicode symbols that screen readers and search can't read, and they don't animate. In <a href="/">BrandBaazi</a> the real fonts are built into <a href="/templates.html">90 animated caption styles</a>. Pick a style, then change the font, case, colour and outline in the Captions tab.</p>
''',
    [
        ('What font do viral Reels captions use?', 'Mostly bold sans-serif fonts like Montserrat Extra Bold, Anton, Bebas Neue and Poppins, with a thick outline and one highlight colour.'),
        ('What is the best font for subtitles?', 'A clean, bold sans-serif such as Montserrat or Poppins at a large size, with an outline or soft background box for contrast.'),
        ('Which font is best for Hindi captions?', 'Noto Sans Devanagari for clean subtitles; Yatra One or Rozha One for bold, stylish Hindi captions.'),
    ],
    ['auto-captions-for-instagram-reels-youtube-shorts', 'how-to-add-auto-captions-to-video', 'hindi-hinglish-caption-generator'],
)

# ---------------------------------------------------------------------------------------------
post(
    'free-youtube-thumbnail-maker',
    'Free YouTube Thumbnail Maker Online — No Watermark',
    'Make YouTube thumbnails, Reels covers, Instagram posts and Pinterest pins free online. Templates, bold text, stickers, and frame-from-video — no watermark, no login.',
    'Free YouTube thumbnail maker — no watermark',
    'A thumbnail decides whether people click. You don\'t need Photoshop: pick a size, a template, add bold text and download.',
    '''
<h2>What you can make</h2>
<ul>
  <li><b>YouTube thumbnails</b> (1280×720)</li>
  <li><b>Reels / Shorts covers</b> (9:16)</li>
  <li><b>Instagram posts</b> and <b>Pinterest pins</b></li>
</ul>

<h2>How to make a thumbnail in 2 minutes</h2>
<ol>
  <li>Open the <a href="/design.html">design studio</a> and choose a size.</li>
  <li>Pick a template, or use a frame straight from your video.</li>
  <li>Replace the photo, edit the text, and add stickers like 🔥 😱 ✅.</li>
  <li>Download at full size — no watermark.</li>
</ol>

<h2>Thumbnail rules that get clicks</h2>
<ul>
  <li><b>3–5 words max</b>, huge and bold — readable on a phone.</li>
  <li><b>A clear face</b> with emotion, looking at the text or the object.</li>
  <li><b>High contrast</b>: light text on dark, or a coloured box behind the text.</li>
  <li><b>Don't repeat the title</b> — the thumbnail should add curiosity.</li>
</ul>
''',
    [
        ('Is the thumbnail maker free?', 'Yes — free, no login, and no watermark on the download.'),
        ('What size is a YouTube thumbnail?', '1280×720 pixels (16:9). The design studio sets it for you.'),
        ('Can I use a frame from my video?', 'Yes. Open your video in the editor and save a frame as a photo, then build the thumbnail from it.'),
    ],
    ['auto-captions-for-instagram-reels-youtube-shorts', 'best-caption-fonts-for-reels', 'hire-video-editor-branding'],
)

# ---------------------------------------------------------------------------------------------
post(
    'hire-video-editor-branding',
    'Need a Video Editor or Branding Help? Work with the BrandBaazi Team',
    'Don\'t have time to edit? Talk to the BrandBaazi team about video editing, Reels, thumbnails, branding and marketing for your brand. Message us on Instagram.',
    'Need an editor or branding help? Work with the BrandBaazi team',
    'The studio is free for doing it yourself. If you\'d rather hand it over — editing, Reels, thumbnails, or your brand\'s content and marketing — you can talk to the team behind BrandBaazi.',
    '''
<h2>Do it yourself — free</h2>
<p>For most creators the <a href="/">free studio</a> is enough: auto captions, viral styles, cuts, music, export, and a <a href="/blog/free-youtube-thumbnail-maker.html">thumbnail maker</a>.</p>

<h2>Or get it done for you</h2>
<p>If you're a business, brand or busy creator, message the BrandBaazi team with:</p>
<ul>
  <li>What you need — e.g. Reels editing, a YouTube channel, thumbnails, brand content or marketing.</li>
  <li>How many videos and how often.</li>
  <li>A link to your page or a sample of the style you like.</li>
</ul>
<p class="box"><b>Message us on Instagram:</b> <a class="cta" href="https://www.instagram.com/brandbaazi.in/" rel="noopener" target="_blank">@brandbaazi.in →</a></p>

<h2>What to prepare before hiring any video editor</h2>
<ol>
  <li><b>Raw footage</b> in the best quality you have (not WhatsApp-compressed).</li>
  <li><b>2–3 reference videos</b> whose style you like.</li>
  <li><b>Your brand basics</b>: logo, colours, fonts, and words you never want shown.</li>
  <li><b>Deadline and number of revisions</b> agreed up front.</li>
</ol>
''',
    [
        ('Is the BrandBaazi studio free?', 'Yes. The caption studio and thumbnail maker are free with no watermark. Working with the team is a separate, paid service.'),
        ('How do I contact the BrandBaazi team?', 'Send a message on Instagram to @brandbaazi.in with what you need, how many videos, and a sample of the style you like.'),
    ],
    ['best-free-auto-caption-generator-no-watermark', 'free-youtube-thumbnail-maker', 'auto-captions-for-instagram-reels-youtube-shorts'],
)

# ---------------------------------------------------------------------------------------------
post(
    'free-auto-subtitle-generator-online',
    'Free Auto Subtitle Generator Online — No Watermark, SRT Download',
    'Free online auto subtitle generator for video: English, Hindi, Hinglish and 30+ languages. Burn subtitles in without watermark or download an SRT file for YouTube, Premiere Pro and DaVinci Resolve.',
    'Free auto subtitle generator online — no watermark, SRT download',
    'Need subtitles fast? Generate them from the speech in your video, fix any word, then burn them in or download an SRT file for YouTube, Premiere Pro or DaVinci Resolve.',
    '''
<h2>Subtitles vs captions — which do you need?</h2>
<ul>
  <li><b>Burned-in captions</b> are part of the video picture — best for Reels, Shorts and WhatsApp, where you can't upload a subtitle file.</li>
  <li><b>Subtitle files (SRT)</b> are separate text with timings — best for YouTube, long videos, and editing software, because viewers can turn them on or off.</li>
</ul>
<p>BrandBaazi gives you both from the same transcript.</p>

<h2>Generate subtitles in 3 steps</h2>
<ol>
  <li>Open <a href="/">brandbaazi.in</a> and upload your video — it stays on your device.</li>
  <li>Choose the spoken language (English, Hindi, Hinglish or 30+ others). Subtitles are generated with timing.</li>
  <li>Fix any word, then either <b>Export video</b> (burned in, no watermark) or press <b>SRT</b> to download the subtitle file.</li>
</ol>

<h2>Use the SRT file in other apps</h2>
<ul>
  <li><b>YouTube:</b> YouTube Studio → Subtitles → Add language → Upload file → "With timing" → choose the .srt.</li>
  <li><b>Premiere Pro:</b> File → Import the .srt, then drag it onto the timeline as a caption track.</li>
  <li><b>DaVinci Resolve (free):</b> import the .srt into the Media Pool and drag it onto the timeline — it becomes a subtitle track you can style.</li>
</ul>
<p>Want styled, animated subtitles in Premiere or DaVinci instead of plain text? Export <b>captions only on a transparent background</b> and place the clip above your video.</p>

<h2>Translate subtitles</h2>
<p>Speak Hindi but want English subtitles? Choose <b>English</b> as the caption language. You can also switch existing captions to another language from the caption language menu.</p>
''',
    [
        ('Is there a free auto subtitle generator without watermark?', 'Yes. BrandBaazi generates subtitles for free, with no login and no watermark on the exported video.'),
        ('Can I download subtitles as an SRT file?', 'Yes. After the subtitles are generated, press SRT to download a .srt file with timings.'),
        ('Can I use the subtitles in DaVinci Resolve or Premiere Pro?', 'Yes. Import the SRT file into DaVinci Resolve or Premiere Pro, or export animated captions on a transparent background and place them over your video.'),
        ('Does it make English subtitles from Hindi speech?', 'Yes. Choose Hindi as the spoken language and English as the caption language.'),
    ],
    ['how-to-add-auto-captions-to-video', 'best-free-auto-caption-generator-no-watermark', 'hindi-hinglish-caption-generator'],
)

# ---------------------------------------------------------------------------------------------
HEAD = '''<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{title}</title>
  <meta name="description" content="{desc}">
  <link rel="canonical" href="{url}">
  <meta name="referrer" content="strict-origin-when-cross-origin">
  <link rel="icon" href="/favicon.ico" sizes="48x48">
  <link rel="icon" type="image/png" sizes="96x96" href="/icons/favicon-96.png">
  <link rel="icon" type="image/png" sizes="192x192" href="/icons/favicon-192.png">
  <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
  <meta name="theme-color" content="#6d28d9">
  <meta property="og:type" content="{ogtype}">
  <meta property="og:site_name" content="BrandBaazi">
  <meta property="og:title" content="{title}">
  <meta property="og:description" content="{desc}">
  <meta property="og:url" content="{url}">
  <meta property="og:image" content="{site}/icons/og.png">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="stylesheet" href="/css/blog.css">
  <script type="application/ld+json">{ld}</script>
</head>
<body>
  <header class="top"><a class="brand" href="/"><img src="/icons/favicon-96.png" alt="" width="30" height="30">BrandBaazi</a><a class="cta" href="/">Free auto captions →</a></header>
'''
FOOT = '''  <footer><a href="/">Studio</a> · <a href="/blog/">Blog</a> · <a href="/templates.html">Caption styles</a> · <a href="/design.html">Thumbnail maker</a> · <a href="/privacy.html">Privacy</a><br>© 2026 BrandBaazi · Free · No watermark · Your video stays on your device</footer>
</body>
</html>
'''

e = html.escape
by_slug = {p['slug']: p for p in POSTS}
os.makedirs(OUT, exist_ok=True)

for p in POSTS:
    url = f"{SITE}/blog/{p['slug']}.html"
    ld = {"@context": "https://schema.org", "@graph": [
        {"@type": "BlogPosting", "headline": p['h1'], "description": p['desc'], "url": url,
         "datePublished": DATE, "dateModified": DATE, "inLanguage": "en",
         "author": {"@type": "Organization", "name": "BrandBaazi", "url": SITE + "/"},
         "publisher": {"@type": "Organization", "name": "BrandBaazi", "logo": {"@type": "ImageObject", "url": SITE + "/icons/icon-512.png"}},
         "image": SITE + "/icons/og.png", "mainEntityOfPage": url},
        {"@type": "FAQPage", "mainEntity": [{"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in p['faq']]},
        {"@type": "BreadcrumbList", "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "Home", "item": SITE + "/"},
            {"@type": "ListItem", "position": 2, "name": "Blog", "item": SITE + "/blog/"},
            {"@type": "ListItem", "position": 3, "name": p['h1'], "item": url}]},
    ]}
    faq = '\n'.join(f'  <details><summary>{e(q)}</summary><p>{e(a)}</p></details>' for q, a in p['faq'])
    rel = '\n'.join(f'    <li><a href="/blog/{s}.html">{e(by_slug[s]["h1"])}</a><p>{e(by_slug[s]["desc"])}</p></li>' for s in p['related'])
    page = HEAD.format(title=e(p['title']), desc=e(p['desc']), url=url, ogtype='article', site=SITE, ld=json.dumps(ld, ensure_ascii=False))
    page += f'''  <main>
  <p class="crumbs"><a href="/">Home</a> › <a href="/blog/">Blog</a></p>
  <h1>{e(p['h1'])}</h1>
  <p class="meta">Updated {DATE} · BrandBaazi</p>
  <p class="lead">{e(p['lead'])}</p>
  {CTA}
{p['body']}
  {CTA}
  <h2>FAQ</h2>
{faq}
  <h2>Read next</h2>
  <ul class="cards">
{rel}
  </ul>
  </main>
''' + FOOT
    with open(os.path.join(OUT, p['slug'] + '.html'), 'w', encoding='utf-8') as f:
        f.write(page)

# Blog index
url = SITE + '/blog/'
ld = {"@context": "https://schema.org", "@type": "Blog", "name": "BrandBaazi Blog", "url": url,
      "blogPost": [{"@type": "BlogPosting", "headline": p['h1'], "url": f"{SITE}/blog/{p['slug']}.html"} for p in POSTS]}
title = 'BrandBaazi Blog — Auto Captions, Reels, Thumbnails & Creator Tips'
desc = 'Guides for creators: free auto caption generator, Hindi & Hinglish captions, viral caption fonts, Reels & Shorts tips and free thumbnails.'
cards = '\n'.join(f'    <li><a href="/blog/{p["slug"]}.html">{e(p["h1"])}</a><p>{e(p["desc"])}</p></li>' for p in POSTS)
page = HEAD.format(title=e(title), desc=e(desc), url=url, ogtype='website', site=SITE, ld=json.dumps(ld, ensure_ascii=False))
page += f'''  <main>
  <h1>BrandBaazi Blog</h1>
  <p class="lead">Free guides for creators — captions, Reels, Shorts, fonts and thumbnails.</p>
  <ul class="cards">
{cards}
  </ul>
  {CTA}
  </main>
''' + FOOT
with open(os.path.join(OUT, 'index.html'), 'w', encoding='utf-8') as f:
    f.write(page)

# Sitemap: site pages + every post
pages = [('/', '1.0', 'weekly'), ('/blog/', '0.9', 'weekly'), ('/templates.html', '0.8', 'weekly'),
         ('/design.html', '0.7', 'monthly'), ('/grow.html', '0.6', 'monthly'), ('/about.html', '0.5', 'monthly'),
         ('/privacy.html', '0.3', 'yearly')] + [(f"/blog/{p['slug']}.html", '0.8', 'monthly') for p in POSTS]
xml = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
xml += [f'  <url><loc>{SITE}{u}</loc><lastmod>{DATE}</lastmod><changefreq>{c}</changefreq><priority>{pr}</priority></url>' for u, pr, c in pages]
xml.append('</urlset>')
with open(os.path.join(OUT, '..', 'sitemap.xml'), 'w', encoding='utf-8') as f:
    f.write('\n'.join(xml) + '\n')
print(f'built {len(POSTS)} posts + index + sitemap')
