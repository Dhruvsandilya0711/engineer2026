# Higgsfield assets for the site

The site is already wired for these. Generate a clip in Higgsfield (the AI
video tool), save it under the exact path below, and it shows up. No code
changes are needed. Restart the server after adding the Rewire video.

## Rules

- **Never feed the ENGINEER '26 logo in.** It must not be redrawn or
  recoloured, and AI tools redraw it. Use the photos only.
- **Start from the real stills** in `public/images/gallery/full/`. Those are
  frames from the 2022 and 2023 aftermovies, so the motion stays true to the
  fest. Don't let it invent crowds, stages or buildings that weren't there.
- **Label AI motion.** Add "AI-animated" to that photo's `credit` in
  `data/gallery.json`.
- **Export:** MP4 (H.264), muted, 3–5 s, landscape. Keep each clip under
  1.5 MB (the Rewire clip under 4 MB). The site runs on one campus server.

## 1. Rewire Reality (biggest impact)

| | |
|---|---|
| Source | `public/images/gallery/full/campus-aerial.webp` |
| Motion | Slow forward drone push over the campus; the scene gradually turns into glowing teal/blue wireframe lines and points, ending as an abstract circuit of light on black |
| Length | 5–6 s, no cuts |
| Save as | `public/video/rewire.mp4` |

The section plays this clip in step with the scroll, replacing the still
photo, and the dot-and-line animation takes over at the end. Keep the last
second dark and mostly black so the handover is clean.

## 2. Living gallery (one loop per photo, do the best 6–8)

Each loop plays only while its photo is at the front of the ring.

| Photo (`full/…`) | Motion to ask for | Save as |
|---|---|---|
| `stage-pyro-co2.webp` | slow push-in, CO2 jets rising, lights flickering | `public/video/gallery/stage-pyro-co2.mp4` |
| `stage-lasers.webp` | lasers sweeping over the crowd | `public/video/gallery/stage-lasers.mp4` |
| `crowd-phone-lights.webp` | phone lights swaying, slow drift | `public/video/gallery/crowd-phone-lights.mp4` |
| `robowars-sparks.webp` | sparks bursting, slight shake | `public/video/gallery/robowars-sparks.mp4` |
| `drone-race.webp` | camera tracks the drone | `public/video/gallery/drone-race.mp4` |
| `baja-dust.webp` | dust rolling, buggy moving | `public/video/gallery/baja-dust.mp4` |
| `campus-main-building-aerial.webp` | slow aerial orbit | `public/video/gallery/campus-main-building-aerial.mp4` |
| `beach-crowd-aerial.webp` | slow aerial drift over the beach | `public/video/gallery/beach-crowd-aerial.mp4` |

Then add the path to that photo in `data/gallery.json`:

```json
{
  "src": "/images/gallery/full/stage-pyro-co2.webp",
  ...
  "credit": "Engineer 2022 official aftermovie (ENGINEER NITK) · AI-animated",
  "loop": "/video/gallery/stage-pyro-co2.mp4"
}
```

Motion should loop cleanly: ask for the end frame to match the start, or
keep the movement slow enough that the cut isn't noticeable.

## 3. Reel shots (not on the site)

- **Crash-zoom bridge:** from `campus-aerial.webp`, push fast downward into
  the campus. Use it between the site clips, at the drop (~9.6 s).
- **Bullet-time orbit:** an orbit around `stage-pyro-co2.webp` for the 1.4 s
  after the drop.
- **Phone in the real world:** a hand holding a phone on the beach at dusk.
  The real screen recording goes onto the phone in the edit, so the site
  footage stays genuine.

Send the finished files and I'll wire in any that need more than a drop-in,
and cut them into the reel.
