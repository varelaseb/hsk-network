# hsk-network

Force-directed network of HSK 1-2 vocabulary in Traditional Chinese with Zhuyin and English definitions. Words sharing a character cluster around that character's hub.

A static site: plain HTML, CSS, JavaScript, and vendored D3 v7. No runtime API or keys.

Spec: [docs/specs/hsk-network.spec.html](docs/specs/hsk-network.spec.html).

## Develop

Python 3 standard library only.

```sh
python3 scripts/build_data.py             # rebuild site/data/graph.json
python3 -m unittest discover -s tests -v  # run tests
python3 -m http.server -d site 8000       # preview at http://localhost:8000
```

See [AGENTS.md](AGENTS.md) for layout, data refresh, and delivery.

## Delivery

Tests run on every pull request and push to main. Every push to main publishes `site/` to GitHub Pages.

## Credits

Vocabulary: HSK 2.0 lists from [clem109/hsk-vocabulary](https://github.com/clem109/hsk-vocabulary) (MIT). Dictionary: [CC-CEDICT](https://cc-cedict.org/) ([CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)); the graph data file is shared under the same license. Graph library: [D3](https://d3js.org/) (ISC).
