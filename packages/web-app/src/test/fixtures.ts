export const identityLut = Array.from({ length: 257 }, (_, index) => index / 256);

export const publicFiltersFixture = {
  categories: [
    {
      id: 'category-film',
      name: '胶片',
      slug: 'film',
      sortOrder: 10,
      filters: [
        {
          id: 'filter-astia',
          slug: 'fuji-astia',
          displayName: 'Fuji Astia',
          sourceName: 'Fuji Astia',
          description: '柔和的人像色彩',
          parserVersion: 1,
          parsed: {
            schemaVersion: 1,
            sourceFormat: 'ncp',
            sourceVersion: 100,
            sourceName: 'Fuji Astia',
            basePictureControl: { code: 2, name: 'Neutral' },
            sharpening: 2,
            saturation: 0,
            hue: 0,
            monochromeFilter: null,
            toningType: null,
            toningStrength: null,
            customCurve: {
              enabled: true,
              gamma: 1,
              controlPoints: [
                { x: 0, y: 0 },
                { x: 255, y: 255 },
              ],
              lut257: identityLut,
            },
            supported: true,
            warnings: [],
          },
        },
      ],
    },
  ],
};
