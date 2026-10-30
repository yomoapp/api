'use strict';
const express = require('express');
const quran = require('../../lib/quran');

const router = express.Router();

router.get('/meta', (_req, res) => {
  res.json({
    totalAyahs: quran.TOTAL_AYAHS,
    totalPages: quran.TOTAL_PAGES,
    surahs: quran.surahs.map((s) => ({
      number: s.number,
      name: s.name,
      nameEn: s.nameEn,
      ayahs: s.ayahs,
      firstPage: s.pages[0],
      lastPage: s.pages[s.pages.length - 1],
    })),
  });
});

module.exports = router;
