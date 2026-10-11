# tailwind

`index.html` is generated from the partials in `sections/` (run `node build.js` to rebuild it after editing a partial). The partials are concatenated in this order: `head`, `header`, `stats`, `steps`, `team`, `pricing`, `tail`.