/* ------------------------------------------------------------------
   Seed food database — per 100 g (or per 100 ml for drinks), as eaten.
   Values are cooked/ready-to-eat unless the name says otherwise.
   Sources: IFCT/NIN Indian food tables, USDA FoodData Central, and
   typical Gulf restaurant preparations. Home cooking varies — edit any
   food from the Foods tab and your version wins.
   ------------------------------------------------------------------ */

const SEED_FOODS = [

  /* ============ SOUTH INDIAN — TIFFIN / BREAKFAST ============ */
  { n: 'Idli',                    g: 'South Indian', kcal: 120, p: 3.7,  c: 25,   f: 0.5,  a: 'iddly steamed rice cake', u: [{ l: '1 idli', g: 45 }, { l: '2 idli', g: 90 }, { l: '3 idli', g: 135 }] },
  { n: 'Rava Idli',               g: 'South Indian', kcal: 150, p: 4.2,  c: 25,   f: 3.8,  a: 'semolina idli', u: [{ l: '1 pc', g: 55 }] },
  { n: 'Dosa (plain)',            g: 'South Indian', kcal: 168, p: 3.9,  c: 28,   f: 4.4,  a: 'sada dosai', u: [{ l: '1 dosa', g: 80 }, { l: '2 dosa', g: 160 }] },
  { n: 'Masala Dosa',             g: 'South Indian', kcal: 172, p: 3.5,  c: 26,   f: 6.0,  a: 'potato dosa', u: [{ l: '1 dosa', g: 150 }] },
  { n: 'Ghee Roast Dosa',         g: 'South Indian', kcal: 230, p: 4.0,  c: 28,   f: 11.5, a: 'ghee dosa', u: [{ l: '1 dosa', g: 90 }] },
  { n: 'Set Dosa / Uttapam',      g: 'South Indian', kcal: 145, p: 3.5,  c: 24,   f: 3.8,  a: 'uthappam oothappam', u: [{ l: '1 pc', g: 90 }] },
  { n: 'Medu Vada',               g: 'South Indian', kcal: 280, p: 7.0,  c: 30,   f: 14.0, a: 'ulundu vadai urad dal vada', u: [{ l: '1 vada', g: 45 }, { l: '2 vada', g: 90 }] },
  { n: 'Upma',                    g: 'South Indian', kcal: 145, p: 3.5,  c: 22,   f: 4.5,  a: 'uppuma rava upma', u: [{ l: '1 cup', g: 180 }] },
  { n: 'Ven Pongal',              g: 'South Indian', kcal: 165, p: 4.5,  c: 24,   f: 5.5,  a: 'khara pongal ghee pongal', u: [{ l: '1 cup', g: 200 }] },
  { n: 'Idiyappam',               g: 'South Indian', kcal: 145, p: 2.8,  c: 32,   f: 0.4,  a: 'string hoppers noolputtu', u: [{ l: '1 pc', g: 50 }, { l: '3 pc', g: 150 }] },
  { n: 'Appam',                   g: 'South Indian', kcal: 145, p: 2.5,  c: 30,   f: 1.5,  a: 'palappam hoppers', u: [{ l: '1 appam', g: 70 }] },
  { n: 'Puttu',                   g: 'South Indian', kcal: 130, p: 2.5,  c: 28,   f: 0.6,  a: 'steamed rice flour cylinder', u: [{ l: '1 puttu', g: 120 }] },
  { n: 'Pesarattu',               g: 'South Indian', kcal: 175, p: 8.0,  c: 24,   f: 5.0,  a: 'moong dal dosa green gram', u: [{ l: '1 pc', g: 100 }] },
  { n: 'Poha',                    g: 'South Indian', kcal: 155, p: 3.0,  c: 27,   f: 4.0,  a: 'aval flattened rice', u: [{ l: '1 cup', g: 170 }] },

  /* ============ SOUTH INDIAN — RICE & BREADS ============ */
  { n: 'White Rice (cooked)',     g: 'South Indian', kcal: 130, p: 2.7,  c: 28,   f: 0.3,  a: 'plain rice sadam steamed rice', u: [{ l: '1 cup', g: 160 }, { l: '1 plate', g: 250 }] },
  { n: 'Brown Rice (cooked)',     g: 'South Indian', kcal: 123, p: 2.7,  c: 26,   f: 1.0,  a: 'red rice matta', u: [{ l: '1 cup', g: 160 }] },
  { n: 'Ghee Rice',               g: 'South Indian', kcal: 200, p: 3.5,  c: 30,   f: 7.0,  a: 'neychoru', u: [{ l: '1 cup', g: 180 }] },
  { n: 'Lemon Rice',              g: 'South Indian', kcal: 180, p: 3.0,  c: 28,   f: 6.0,  a: 'chitranna elumichai sadam', u: [{ l: '1 cup', g: 180 }] },
  { n: 'Tamarind Rice',           g: 'South Indian', kcal: 190, p: 3.5,  c: 29,   f: 6.5,  a: 'puliyodarai puliyogare', u: [{ l: '1 cup', g: 180 }] },
  { n: 'Curd Rice',               g: 'South Indian', kcal: 110, p: 3.2,  c: 17,   f: 3.0,  a: 'thayir sadam yogurt rice daddojanam', u: [{ l: '1 cup', g: 200 }] },
  { n: 'Coconut Rice',            g: 'South Indian', kcal: 200, p: 3.2,  c: 28,   f: 8.5,  a: 'thengai sadam', u: [{ l: '1 cup', g: 180 }] },
  { n: 'Chapati / Roti',          g: 'South Indian', kcal: 275, p: 8.5,  c: 48,   f: 5.5,  a: 'phulka wheat roti', u: [{ l: '1 chapati', g: 45 }, { l: '2 chapati', g: 90 }, { l: '3 chapati', g: 135 }] },
  { n: 'Kerala Parotta',          g: 'South Indian', kcal: 350, p: 6.5,  c: 45,   f: 15.0, a: 'porotta malabar paratha barotta', u: [{ l: '1 parotta', g: 80 }, { l: '2 parotta', g: 160 }] },
  { n: 'Poori',                   g: 'South Indian', kcal: 340, p: 6.0,  c: 42,   f: 16.0, a: 'puri deep fried bread', u: [{ l: '1 poori', g: 30 }, { l: '3 poori', g: 90 }] },

  /* ============ SOUTH INDIAN — CURRIES, DALS & SIDES ============ */
  { n: 'Sambar',                  g: 'South Indian', kcal: 65,  p: 3.0,  c: 9.0,  f: 2.0,  a: 'sambhar lentil stew', u: [{ l: '1 ladle', g: 100 }, { l: '1 bowl', g: 200 }] },
  { n: 'Rasam',                   g: 'South Indian', kcal: 35,  p: 1.2,  c: 5.0,  f: 1.0,  a: 'saaru charu pepper soup', u: [{ l: '1 bowl', g: 150 }] },
  { n: 'Toor Dal (cooked)',       g: 'South Indian', kcal: 115, p: 6.0,  c: 18,   f: 2.0,  a: 'dal tadka paruppu arhar lentils', u: [{ l: '1 bowl', g: 180 }] },
  { n: 'Moong Dal (cooked)',      g: 'South Indian', kcal: 105, p: 7.0,  c: 16,   f: 1.5,  a: 'green gram dal pasi paruppu' },
  { n: 'Coconut Chutney',         g: 'South Indian', kcal: 190, p: 3.0,  c: 8.0,  f: 16.0, a: 'thengai chutney', u: [{ l: '1 tbsp', g: 18 }, { l: '2 tbsp', g: 36 }] },
  { n: 'Tomato Chutney',          g: 'South Indian', kcal: 90,  p: 2.0,  c: 8.0,  f: 5.5,  a: 'thakkali chutney', u: [{ l: '2 tbsp', g: 36 }] },
  { n: 'Idli Podi + Oil',         g: 'South Indian', kcal: 460, p: 15.0, c: 35,   f: 28.0, a: 'milagai podi gunpowder chutney powder', u: [{ l: '1 tsp', g: 6 }, { l: '1 tbsp', g: 15 }] },
  { n: 'Avial',                   g: 'South Indian', kcal: 130, p: 2.5,  c: 9.0,  f: 9.0,  a: 'mixed vegetable coconut curry', u: [{ l: '1 serving', g: 120 }] },
  { n: 'Thoran / Poriyal',        g: 'South Indian', kcal: 105, p: 2.5,  c: 8.0,  f: 7.0,  a: 'cabbage beans coconut stir fry', u: [{ l: '1 serving', g: 100 }] },
  { n: 'Kootu',                   g: 'South Indian', kcal: 95,  p: 3.5,  c: 10,   f: 4.5,  a: 'vegetable lentil curry' },
  { n: 'Potato Masala',           g: 'South Indian', kcal: 115, p: 2.2,  c: 17,   f: 4.5,  a: 'aloo masala dosa filling urulai', u: [{ l: '1 serving', g: 120 }] },
  { n: 'Kerala Veg Stew',         g: 'South Indian', kcal: 110, p: 2.0,  c: 9.0,  f: 7.5,  a: 'ishtu coconut milk stew', u: [{ l: '1 bowl', g: 180 }] },
  { n: 'Curd / Plain Yogurt',     g: 'South Indian', kcal: 62,  p: 3.5,  c: 4.7,  f: 3.3,  a: 'thayir dahi full fat yogurt', u: [{ l: '1 cup', g: 200 }] },
  { n: 'Buttermilk (moru)',       g: 'South Indian', kcal: 40,  p: 1.6,  c: 4.8,  f: 1.5,  a: 'neer mor chaas sambaram', u: [{ l: '1 glass', g: 250 }] },
  { n: 'Pickle (mango/lime)',     g: 'South Indian', kcal: 180, p: 1.0,  c: 12,   f: 14.0, a: 'achar oorugai', u: [{ l: '1 tsp', g: 8 }] },
  { n: 'Papad (fried)',           g: 'South Indian', kcal: 460, p: 18.0, c: 50,   f: 20.0, a: 'appalam papadum', u: [{ l: '1 pc', g: 12 }] },
  { n: 'Ghee',                    g: 'Fats & Oils',  kcal: 900, p: 0,    c: 0,    f: 100,  a: 'clarified butter nei', u: [{ l: '1 tsp', g: 5 }, { l: '1 tbsp', g: 14 }] },
  { n: 'Coconut Oil',             g: 'Fats & Oils',  kcal: 892, p: 0,    c: 0,    f: 99,   a: 'velichenna cooking oil', u: [{ l: '1 tsp', g: 5 }, { l: '1 tbsp', g: 14 }] },
  { n: 'Olive Oil',               g: 'Fats & Oils',  kcal: 884, p: 0,    c: 0,    f: 100,  a: 'zeit zaytoun', u: [{ l: '1 tbsp', g: 14 }] },
  { n: 'Sunflower Oil',           g: 'Fats & Oils',  kcal: 884, p: 0,    c: 0,    f: 100,  a: 'refined cooking oil', u: [{ l: '1 tbsp', g: 14 }] },

  /* ============ INDIAN NON-VEG ============ */
  { n: 'Chicken Curry',           g: 'Indian Non-Veg', kcal: 150, p: 14.0, c: 4.0,  f: 9.0,  a: 'kozhi kuzhambu home style chicken masala', u: [{ l: '1 bowl', g: 200 }, { l: '2 pcs + gravy', g: 150 }] },
  { n: 'Chicken Chettinad',       g: 'Indian Non-Veg', kcal: 180, p: 16.0, c: 5.0,  f: 11.0, a: 'pepper chicken masala', u: [{ l: '1 bowl', g: 180 }] },
  { n: 'Butter Chicken',          g: 'Indian Non-Veg', kcal: 215, p: 13.0, c: 6.0,  f: 15.0, a: 'murgh makhani', u: [{ l: '1 bowl', g: 200 }] },
  { n: 'Chicken 65',              g: 'Indian Non-Veg', kcal: 250, p: 18.0, c: 12,   f: 15.0, a: 'fried chicken starter', u: [{ l: '1 serving', g: 120 }] },
  { n: 'Tandoori / Grilled Chicken', g: 'Indian Non-Veg', kcal: 165, p: 25.0, c: 2.0, f: 6.0, a: 'grill chicken bbq', u: [{ l: '1/4 chicken', g: 200 }, { l: '1 leg', g: 110 }] },
  { n: 'Chicken Breast (plain cooked)', g: 'Indian Non-Veg', kcal: 165, p: 31.0, c: 0, f: 3.6, a: 'boiled grilled chicken breast skinless', u: [{ l: '1 breast', g: 150 }] },
  { n: 'Fish Curry',              g: 'Indian Non-Veg', kcal: 110, p: 12.0, c: 4.0,  f: 5.0,  a: 'meen kulambu meen curry', u: [{ l: '1 bowl', g: 180 }] },
  { n: 'Fish Fry (shallow)',      g: 'Indian Non-Veg', kcal: 200, p: 20.0, c: 5.0,  f: 11.0, a: 'meen varuval fried fish', u: [{ l: '1 pc', g: 100 }] },
  { n: 'Mutton Curry',            g: 'Indian Non-Veg', kcal: 210, p: 15.0, c: 4.0,  f: 15.0, a: 'goat curry lamb kuzhambu', u: [{ l: '1 bowl', g: 180 }] },
  { n: 'Prawn Masala',            g: 'Indian Non-Veg', kcal: 120, p: 13.0, c: 4.0,  f: 6.0,  a: 'eral shrimp curry chemmeen', u: [{ l: '1 bowl', g: 150 }] },
  { n: 'Egg Curry',               g: 'Indian Non-Veg', kcal: 145, p: 8.0,  c: 5.0,  f: 10.0, a: 'muttai kuzhambu anda curry', u: [{ l: '1 egg + gravy', g: 140 }] },
  { n: 'Boiled Egg',              g: 'Indian Non-Veg', kcal: 155, p: 13.0, c: 1.1,  f: 11.0, a: 'hard boiled egg muttai', u: [{ l: '1 egg', g: 50 }, { l: '2 eggs', g: 100 }, { l: '3 eggs', g: 150 }] },
  { n: 'Omelette (2 eggs)',       g: 'Indian Non-Veg', kcal: 170, p: 11.0, c: 1.5,  f: 13.0, a: 'egg omlet fried egg', u: [{ l: '2-egg omelette', g: 120 }] },
  { n: 'Egg White (cooked)',      g: 'Indian Non-Veg', kcal: 52,  p: 11.0, c: 0.7,  f: 0.2,  a: 'egg whites', u: [{ l: '1 white', g: 33 }] },
  { n: 'Chicken Biryani',         g: 'Indian Non-Veg', kcal: 180, p: 10.0, c: 22,   f: 6.0,  a: 'biriyani dum biryani', u: [{ l: '1 plate', g: 350 }, { l: '1 cup', g: 180 }] },
  { n: 'Mutton Biryani',          g: 'Indian Non-Veg', kcal: 210, p: 10.0, c: 22,   f: 9.0,  a: 'lamb biriyani', u: [{ l: '1 plate', g: 350 }] },
  { n: 'Chicken Fried Rice',      g: 'Indian Non-Veg', kcal: 165, p: 7.5,  c: 22,   f: 5.5,  a: 'fried rice chinese', u: [{ l: '1 plate', g: 300 }] },
  { n: 'Paneer Butter Masala',    g: 'Indian Non-Veg', kcal: 225, p: 9.0,  c: 8.0,  f: 18.0, a: 'paneer curry', u: [{ l: '1 bowl', g: 180 }] },

  /* ============ SAUDI / GULF MAINS ============ */
  { n: 'Chicken Kabsa',           g: 'Saudi / Gulf', kcal: 190, p: 11.0, c: 22,   f: 7.0,  a: 'kabsah dajaj rice arabic rice', u: [{ l: '1 plate', g: 400 }, { l: '1 cup', g: 180 }] },
  { n: 'Lamb Kabsa',              g: 'Saudi / Gulf', kcal: 215, p: 11.0, c: 22,   f: 9.0,  a: 'kabsa laham mutton kabsa', u: [{ l: '1 plate', g: 400 }] },
  { n: 'Chicken Mandi',           g: 'Saudi / Gulf', kcal: 180, p: 12.0, c: 21,   f: 6.0,  a: 'mandy smoked chicken rice yemeni', u: [{ l: '1 plate', g: 400 }, { l: '1/4 plate', g: 200 }] },
  { n: 'Lamb Mandi',              g: 'Saudi / Gulf', kcal: 205, p: 12.0, c: 20,   f: 9.0,  a: 'mandi laham mutton mandi', u: [{ l: '1 plate', g: 400 }] },
  { n: 'Chicken Madhbi',          g: 'Saudi / Gulf', kcal: 195, p: 13.0, c: 20,   f: 7.5,  a: 'mathbi madhbee grilled stone chicken', u: [{ l: '1 plate', g: 400 }] },
  { n: 'Chicken Shawarma (meat only)', g: 'Saudi / Gulf', kcal: 190, p: 18.0, c: 3.0, f: 12.0, a: 'shawarma dajaj', u: [{ l: '1 serving', g: 120 }] },
  { n: 'Chicken Shawarma Sandwich',    g: 'Saudi / Gulf', kcal: 215, p: 12.0, c: 20,  f: 10.0, a: 'shawarma wrap roll sandwich', u: [{ l: '1 regular', g: 180 }, { l: '1 large / super', g: 300 }] },
  { n: 'Beef Shawarma Sandwich',       g: 'Saudi / Gulf', kcal: 235, p: 13.0, c: 20,  f: 12.5, a: 'shawarma laham meat shawarma', u: [{ l: '1 regular', g: 180 }] },
  { n: 'Broast Chicken (fried)',  g: 'Saudi / Gulf', kcal: 280, p: 20.0, c: 12,   f: 18.0, a: 'broasted chicken al baik fried chicken', u: [{ l: '1 pc', g: 110 }, { l: '4 pc meal', g: 440 }] },
  { n: 'Shish Tawook',            g: 'Saudi / Gulf', kcal: 165, p: 24.0, c: 2.0,  f: 7.0,  a: 'chicken skewer tawouk grilled', u: [{ l: '1 skewer', g: 120 }] },
  { n: 'Kofta / Kebab (grilled)', g: 'Saudi / Gulf', kcal: 230, p: 18.0, c: 3.0,  f: 16.0, a: 'kabab lamb kofta mixed grill', u: [{ l: '1 skewer', g: 100 }] },
  { n: 'Saleeg',                  g: 'Saudi / Gulf', kcal: 140, p: 6.0,  c: 18,   f: 5.0,  a: 'saudi milk rice', u: [{ l: '1 plate', g: 300 }] },
  { n: 'Jareesh',                 g: 'Saudi / Gulf', kcal: 130, p: 5.0,  c: 18,   f: 4.0,  a: 'crushed wheat saudi', u: [{ l: '1 bowl', g: 250 }] },
  { n: 'Maqluba',                 g: 'Saudi / Gulf', kcal: 165, p: 8.0,  c: 20,   f: 6.0,  a: 'maklouba upside down rice', u: [{ l: '1 plate', g: 350 }] },
  { n: 'Grilled Fish (Gulf style)', g: 'Saudi / Gulf', kcal: 160, p: 24.0, c: 1.0, f: 7.0,  a: 'samak mashwi hamour', u: [{ l: '1 fillet', g: 180 }] },

  /* ============ GULF SIDES, BREADS, SNACKS & DRINKS ============ */
  { n: 'Khubz / Arabic Bread',    g: 'Saudi / Gulf', kcal: 275, p: 9.0,  c: 55,   f: 1.5,  a: 'pita bread khobz samoon flat bread', u: [{ l: '1 small loaf', g: 60 }, { l: '1 large loaf', g: 110 }] },
  { n: 'Tamees / Tandoor Bread',  g: 'Saudi / Gulf', kcal: 290, p: 9.0,  c: 55,   f: 3.5,  a: 'tameez afghani bread naan', u: [{ l: '1 bread', g: 150 }] },
  { n: 'Hummus',                  g: 'Saudi / Gulf', kcal: 175, p: 8.0,  c: 15,   f: 10.0, a: 'hommos chickpea dip', u: [{ l: '1 tbsp', g: 20 }, { l: '1 small bowl', g: 100 }] },
  { n: 'Mutabbal / Baba Ganoush', g: 'Saudi / Gulf', kcal: 130, p: 3.0,  c: 8.0,  f: 10.0, a: 'eggplant dip moutabal', u: [{ l: '1 small bowl', g: 100 }] },
  { n: 'Foul Medames',            g: 'Saudi / Gulf', kcal: 110, p: 6.0,  c: 14,   f: 3.5,  a: 'ful fava beans breakfast beans', u: [{ l: '1 bowl', g: 200 }] },
  { n: 'Falafel',                 g: 'Saudi / Gulf', kcal: 330, p: 13.0, c: 32,   f: 18.0, a: 'tameya chickpea fritter', u: [{ l: '1 pc', g: 25 }, { l: '5 pc', g: 125 }] },
  { n: 'Samboosa (fried)',        g: 'Saudi / Gulf', kcal: 300, p: 8.0,  c: 30,   f: 16.0, a: 'sambusa samosa ramadan snack', u: [{ l: '1 pc', g: 35 }, { l: '3 pc', g: 105 }] },
  { n: 'Tabbouleh',               g: 'Saudi / Gulf', kcal: 120, p: 2.5,  c: 15,   f: 6.0,  a: 'parsley bulgur salad tabouleh', u: [{ l: '1 bowl', g: 150 }] },
  { n: 'Fattoush',                g: 'Saudi / Gulf', kcal: 110, p: 2.5,  c: 12,   f: 6.0,  a: 'arabic bread salad', u: [{ l: '1 bowl', g: 200 }] },
  { n: 'Arabic Salad',            g: 'Saudi / Gulf', kcal: 55,  p: 1.2,  c: 6.0,  f: 3.0,  a: 'salata cucumber tomato salad', u: [{ l: '1 bowl', g: 200 }] },
  { n: 'Labneh',                  g: 'Saudi / Gulf', kcal: 175, p: 8.0,  c: 6.0,  f: 13.0, a: 'strained yogurt cheese', u: [{ l: '1 tbsp', g: 20 }] },
  { n: 'Tahini',                  g: 'Saudi / Gulf', kcal: 595, p: 17.0, c: 21,   f: 54.0, a: 'sesame paste tahina', u: [{ l: '1 tbsp', g: 15 }] },
  { n: 'Dates',                   g: 'Saudi / Gulf', kcal: 282, p: 2.5,  c: 75,   f: 0.4,  a: 'tamr khudri ajwa sukkari medjool', u: [{ l: '1 date', g: 8 }, { l: '3 dates', g: 24 }, { l: '5 dates', g: 40 }] },
  { n: 'Laban (drinking yogurt)', g: 'Saudi / Gulf', kcal: 45,  p: 3.2,  c: 4.5,  f: 1.5,  a: 'ayran buttermilk laban up', u: [{ l: '1 glass', g: 250 }, { l: '1 bottle', g: 350 }] },
  { n: 'Karak Chai',              g: 'Saudi / Gulf', kcal: 70,  p: 1.5,  c: 10,   f: 2.5,  a: 'karak tea milk tea sulaimani chai', u: [{ l: '1 small cup', g: 120 }, { l: '1 glass', g: 200 }] },
  { n: 'Arabic Coffee (gahwa)',   g: 'Saudi / Gulf', kcal: 5,   p: 0.2,  c: 0.8,  f: 0,    a: 'qahwa kahwa', u: [{ l: '1 cup', g: 60 }] },
  { n: 'Kunafa',                  g: 'Saudi / Gulf', kcal: 350, p: 6.0,  c: 40,   f: 18.0, a: 'knafeh dessert', u: [{ l: '1 slice', g: 120 }] },
  { n: 'Basbousa',                g: 'Saudi / Gulf', kcal: 380, p: 5.0,  c: 50,   f: 17.0, a: 'semolina cake harissa dessert', u: [{ l: '1 piece', g: 70 }] },
  { n: 'Vimto / Soft Drink',      g: 'Saudi / Gulf', kcal: 42,  p: 0,    c: 10.5, f: 0,    a: 'pepsi cola soda mirinda', u: [{ l: '1 can (330ml)', g: 330 }] },

  /* ============ PROTEIN, DAIRY, NUTS & BASICS ============ */
  { n: 'Whey Protein Powder',     g: 'Protein & Basics', kcal: 400, p: 80.0, c: 8.0, f: 6.0, a: 'whey isolate protein shake supplement', u: [{ l: '1 scoop (30g)', g: 30 }, { l: '2 scoops', g: 60 }] },
  { n: 'Full Cream Milk',         g: 'Protein & Basics', kcal: 61,  p: 3.2,  c: 4.8, f: 3.3, a: 'milk haleeb almarai laban halib', u: [{ l: '1 glass', g: 250 }, { l: '1 litre', g: 1000 }] },
  { n: 'Low Fat Milk',            g: 'Protein & Basics', kcal: 42,  p: 3.4,  c: 5.0, f: 1.0, a: 'skim milk light milk', u: [{ l: '1 glass', g: 250 }] },
  { n: 'Greek Yogurt (plain)',    g: 'Protein & Basics', kcal: 97,  p: 9.0,  c: 4.0, f: 5.0, a: 'high protein yogurt', u: [{ l: '1 pot', g: 170 }] },
  { n: 'Paneer',                  g: 'Protein & Basics', kcal: 265, p: 18.0, c: 6.0, f: 20.0, a: 'cottage cheese indian cheese', u: [{ l: '1 serving', g: 100 }] },
  { n: 'Cheese Slice',            g: 'Protein & Basics', kcal: 300, p: 17.0, c: 5.0, f: 24.0, a: 'processed cheese kraft', u: [{ l: '1 slice', g: 20 }] },
  { n: 'Peanut Butter',           g: 'Protein & Basics', kcal: 588, p: 25.0, c: 20,  f: 50.0, a: 'pb nut butter', u: [{ l: '1 tbsp', g: 16 }, { l: '2 tbsp', g: 32 }] },
  { n: 'Peanuts (roasted)',       g: 'Protein & Basics', kcal: 585, p: 26.0, c: 21,  f: 49.0, a: 'groundnut kadalai', u: [{ l: '1 handful', g: 30 }] },
  { n: 'Almonds',                 g: 'Protein & Basics', kcal: 579, p: 21.0, c: 22,  f: 50.0, a: 'badam nuts', u: [{ l: '10 almonds', g: 12 }, { l: '1 handful', g: 30 }] },
  { n: 'Cashews',                 g: 'Protein & Basics', kcal: 553, p: 18.0, c: 30,  f: 44.0, a: 'kaju nuts', u: [{ l: '1 handful', g: 30 }] },
  { n: 'Oats (dry)',              g: 'Protein & Basics', kcal: 389, p: 16.9, c: 66,  f: 6.9,  a: 'rolled oats oatmeal quaker', u: [{ l: '1/2 cup dry', g: 40 }, { l: '1 cup dry', g: 80 }] },
  { n: 'Chickpeas (cooked)',      g: 'Protein & Basics', kcal: 164, p: 8.9,  c: 27,  f: 2.6,  a: 'chana garbanzo kondakadalai', u: [{ l: '1 cup', g: 165 }] },
  { n: 'Tuna (canned in water)',  g: 'Protein & Basics', kcal: 116, p: 26.0, c: 0,   f: 1.0,  a: 'canned tuna fish', u: [{ l: '1 can', g: 100 }] },
  { n: 'Banana',                  g: 'Protein & Basics', kcal: 89,  p: 1.1,  c: 23,  f: 0.3,  a: 'nendran pazham fruit', u: [{ l: '1 medium', g: 120 }, { l: '1 large', g: 150 }] },
  { n: 'Apple',                   g: 'Protein & Basics', kcal: 52,  p: 0.3,  c: 14,  f: 0.2,  a: 'fruit', u: [{ l: '1 medium', g: 180 }] },
  { n: 'Sugar',                   g: 'Protein & Basics', kcal: 387, p: 0,    c: 100, f: 0,    a: 'white sugar cane sugar', u: [{ l: '1 tsp', g: 4 }, { l: '1 tbsp', g: 12 }] },
  { n: 'Honey',                   g: 'Protein & Basics', kcal: 304, p: 0.3,  c: 82,  f: 0,    a: 'asal sidr honey', u: [{ l: '1 tbsp', g: 21 }] },
];

/* ------------------------------------------------------------------
   Micronutrients per 100 g, keyed by the food's slug.
     fb = fibre (g)     sg = sugar (g)        na = sodium (mg)
     ch = cholesterol (mg)  ca = calcium (mg)  fe = iron (mg)
   Fibre, sugar and sodium are filled in for everything. Cholesterol,
   calcium and iron are only listed where the value is well established
   (dairy, eggs, meat, nuts, pulses) — elsewhere they stay unknown and
   the app shows "—" rather than inventing a number.
   Sodium in cooked dishes depends entirely on how much salt goes in;
   treat those as ballpark.
   ------------------------------------------------------------------ */
const SEED_MICROS = {
  /* South Indian — tiffin */
  'idli':            { fb: 1.0,  sg: 0.2,  na: 230 },
  'rava-idli':       { fb: 1.2,  sg: 0.8,  na: 280 },
  'dosa-plain':      { fb: 1.2,  sg: 0.4,  na: 210 },
  'masala-dosa':     { fb: 2.0,  sg: 1.0,  na: 280 },
  'ghee-roast-dosa': { fb: 1.2,  sg: 0.4,  na: 220, ch: 22 },
  'set-dosa-uttapam':{ fb: 1.5,  sg: 0.8,  na: 250 },
  'medu-vada':       { fb: 3.5,  sg: 0.6,  na: 380, fe: 1.8 },
  'upma':            { fb: 1.8,  sg: 1.0,  na: 380 },
  'ven-pongal':      { fb: 1.5,  sg: 0.3,  na: 300, ch: 14 },
  'idiyappam':       { fb: 1.0,  sg: 0.1,  na: 90 },
  'appam':           { fb: 0.8,  sg: 3.5,  na: 130 },
  'puttu':           { fb: 1.5,  sg: 0.3,  na: 70 },
  'pesarattu':       { fb: 4.0,  sg: 0.8,  na: 260, fe: 2.0 },
  'poha':            { fb: 1.2,  sg: 1.5,  na: 300, fe: 2.7 },

  /* South Indian — rice & breads */
  'white-rice-cooked':{ fb: 0.4, sg: 0.1,  na: 1,   ch: 0 },
  'brown-rice-cooked':{ fb: 1.8, sg: 0.4,  na: 4,   ch: 0, fe: 0.6 },
  'ghee-rice':       { fb: 0.8,  sg: 0.5,  na: 320, ch: 18 },
  'lemon-rice':      { fb: 1.0,  sg: 0.4,  na: 400 },
  'tamarind-rice':   { fb: 1.5,  sg: 2.5,  na: 450 },
  'curd-rice':       { fb: 0.4,  sg: 1.8,  na: 280, ch: 6,  ca: 60 },
  'coconut-rice':    { fb: 1.8,  sg: 1.2,  na: 320 },
  'chapati-roti':    { fb: 6.5,  sg: 1.2,  na: 320, fe: 2.5, ca: 40 },
  'kerala-parotta':  { fb: 2.0,  sg: 1.5,  na: 400 },
  'poori':           { fb: 3.5,  sg: 0.8,  na: 250, fe: 1.8 },

  /* South Indian — curries, dals, sides */
  'sambar':          { fb: 2.5,  sg: 1.5,  na: 450, fe: 1.0 },
  'rasam':           { fb: 0.8,  sg: 1.0,  na: 400 },
  'toor-dal-cooked': { fb: 4.5,  sg: 1.0,  na: 300, fe: 1.5, ca: 25 },
  'moong-dal-cooked':{ fb: 4.0,  sg: 0.8,  na: 280, fe: 1.4, ca: 22 },
  'coconut-chutney': { fb: 4.5,  sg: 2.0,  na: 300 },
  'tomato-chutney':  { fb: 2.0,  sg: 4.0,  na: 380 },
  'idli-podi-oil':   { fb: 12.0, sg: 2.0,  na: 900, fe: 4.0 },
  'avial':           { fb: 3.0,  sg: 2.5,  na: 280 },
  'thoran-poriyal':  { fb: 3.5,  sg: 2.0,  na: 250 },
  'kootu':           { fb: 3.5,  sg: 1.8,  na: 280, fe: 1.2 },
  'potato-masala':   { fb: 2.0,  sg: 1.5,  na: 320 },
  'kerala-veg-stew': { fb: 1.8,  sg: 2.0,  na: 260 },
  'curd-plain-yogurt':{ fb: 0,   sg: 4.7,  na: 46,  ch: 13, ca: 120 },
  'buttermilk-moru': { fb: 0,    sg: 4.0,  na: 120, ch: 5,  ca: 90 },
  'pickle-mango-lime':{ fb: 2.0, sg: 6.0,  na: 2400 },
  'papad-fried':     { fb: 8.0,  sg: 1.0,  na: 1600, fe: 3.0 },
  'ghee':            { fb: 0,    sg: 0,    na: 2,   ch: 256 },
  'coconut-oil':     { fb: 0,    sg: 0,    na: 0,   ch: 0 },
  'olive-oil':       { fb: 0,    sg: 0,    na: 2,   ch: 0 },
  'sunflower-oil':   { fb: 0,    sg: 0,    na: 0,   ch: 0 },

  /* Indian non-veg */
  'chicken-curry':   { fb: 1.0,  sg: 1.5,  na: 420, ch: 55 },
  'chicken-chettinad':{ fb: 1.5, sg: 1.5,  na: 450, ch: 62 },
  'butter-chicken':  { fb: 1.0,  sg: 3.5,  na: 420, ch: 60, ca: 55 },
  'chicken-65':      { fb: 1.0,  sg: 1.0,  na: 620, ch: 70 },
  'tandoori-grilled-chicken':{ fb: 0.3, sg: 0.8, na: 480, ch: 90 },
  'chicken-breast-plain-cooked':{ fb: 0, sg: 0,  na: 74,  ch: 85, fe: 1.0 },
  'fish-curry':      { fb: 1.0,  sg: 1.2,  na: 400, ch: 40 },
  'fish-fry-shallow':{ fb: 0.5,  sg: 0.3,  na: 450, ch: 55 },
  'mutton-curry':    { fb: 1.0,  sg: 1.2,  na: 400, ch: 75, fe: 2.0 },
  'prawn-masala':    { fb: 0.8,  sg: 1.0,  na: 480, ch: 130 },
  'egg-curry':       { fb: 0.8,  sg: 1.5,  na: 380, ch: 210, ca: 45 },
  'boiled-egg':      { fb: 0,    sg: 1.1,  na: 124, ch: 373, ca: 50, fe: 1.2 },
  'omelette-2-eggs': { fb: 0.2,  sg: 0.9,  na: 300, ch: 320, ca: 45, fe: 1.3 },
  'egg-white-cooked':{ fb: 0,    sg: 0.7,  na: 166, ch: 0,  ca: 7 },
  'chicken-biryani': { fb: 1.2,  sg: 1.5,  na: 480, ch: 35 },
  'mutton-biryani':  { fb: 1.2,  sg: 1.5,  na: 480, ch: 45 },
  'chicken-fried-rice':{ fb: 1.0, sg: 1.2, na: 520, ch: 30 },
  'paneer-butter-masala':{ fb: 1.5, sg: 4.0, na: 450, ch: 45, ca: 200 },

  /* Saudi / Gulf mains */
  'chicken-kabsa':   { fb: 1.2,  sg: 2.0,  na: 450, ch: 35 },
  'lamb-kabsa':      { fb: 1.2,  sg: 2.0,  na: 460, ch: 42 },
  'chicken-mandi':   { fb: 1.0,  sg: 1.2,  na: 400, ch: 38 },
  'lamb-mandi':      { fb: 1.0,  sg: 1.2,  na: 420, ch: 45 },
  'chicken-madhbi':  { fb: 1.0,  sg: 1.5,  na: 430, ch: 40 },
  'chicken-shawarma-meat-only':{ fb: 0.5, sg: 1.0, na: 620, ch: 65 },
  'chicken-shawarma-sandwich': { fb: 1.5, sg: 1.5, na: 560, ch: 32 },
  'beef-shawarma-sandwich':    { fb: 1.5, sg: 1.5, na: 600, ch: 38 },
  'broast-chicken-fried':{ fb: 0.8, sg: 0.5, na: 700, ch: 75 },
  'shish-tawook':    { fb: 0.3,  sg: 0.8,  na: 520, ch: 78 },
  'kofta-kebab-grilled':{ fb: 0.5, sg: 0.8, na: 560, ch: 65, fe: 2.2 },
  'saleeg':          { fb: 0.6,  sg: 2.0,  na: 350, ch: 18, ca: 70 },
  'jareesh':         { fb: 2.5,  sg: 1.5,  na: 340, ch: 12 },
  'maqluba':         { fb: 2.0,  sg: 2.0,  na: 420, ch: 25 },
  'grilled-fish-gulf-style':{ fb: 0, sg: 0.3, na: 320, ch: 55 },

  /* Gulf sides, breads, snacks, drinks */
  'khubz-arabic-bread':{ fb: 2.5, sg: 2.0, na: 520, fe: 2.4 },
  'tamees-tandoor-bread':{ fb: 2.8, sg: 2.5, na: 500, fe: 2.5 },
  'hummus':          { fb: 6.0,  sg: 0.5,  na: 380, ca: 38, fe: 2.4 },
  'mutabbal-baba-ganoush':{ fb: 4.0, sg: 3.0, na: 350 },
  'foul-medames':    { fb: 5.5,  sg: 0.8,  na: 400, fe: 2.0, ca: 40 },
  'falafel':         { fb: 5.0,  sg: 1.5,  na: 590, fe: 3.4, ca: 54 },
  'samboosa-fried':  { fb: 2.5,  sg: 1.5,  na: 520 },
  'tabbouleh':       { fb: 3.0,  sg: 2.0,  na: 320, fe: 1.5 },
  'fattoush':        { fb: 2.5,  sg: 3.0,  na: 300 },
  'arabic-salad':    { fb: 1.5,  sg: 3.0,  na: 180 },
  'labneh':          { fb: 0,    sg: 4.0,  na: 300, ch: 35, ca: 180 },
  'tahini':          { fb: 9.3,  sg: 0.5,  na: 115, ca: 426, fe: 8.9 },
  'dates':           { fb: 8.0,  sg: 63.0, na: 2,   ca: 39, fe: 1.0 },
  'laban-drinking-yogurt':{ fb: 0, sg: 4.5, na: 60, ch: 6,  ca: 115 },
  'karak-chai':      { fb: 0,    sg: 9.0,  na: 25,  ch: 8,  ca: 55 },
  'arabic-coffee-gahwa':{ fb: 0, sg: 0,    na: 3,   ch: 0 },
  'kunafa':          { fb: 1.5,  sg: 30.0, na: 220, ch: 40, ca: 100 },
  'basbousa':        { fb: 1.5,  sg: 35.0, na: 180, ch: 25, ca: 60 },
  'vimto-soft-drink':{ fb: 0,    sg: 10.5, na: 10,  ch: 0 },

  /* Protein, dairy, nuts & basics */
  'whey-protein-powder':{ fb: 1.0, sg: 5.0, na: 300, ch: 30, ca: 500 },
  'full-cream-milk': { fb: 0,    sg: 4.8,  na: 43,  ch: 10, ca: 113 },
  'low-fat-milk':    { fb: 0,    sg: 5.0,  na: 44,  ch: 5,  ca: 125 },
  'greek-yogurt-plain':{ fb: 0,  sg: 4.0,  na: 36,  ch: 13, ca: 100 },
  'paneer':          { fb: 0,    sg: 3.5,  na: 22,  ch: 60, ca: 480 },
  'cheese-slice':    { fb: 0,    sg: 5.0,  na: 1300, ch: 70, ca: 500 },
  'peanut-butter':   { fb: 6.0,  sg: 9.0,  na: 430, ca: 43, fe: 1.9 },
  'peanuts-roasted': { fb: 8.5,  sg: 4.2,  na: 6,   ca: 92, fe: 2.3 },
  'almonds':         { fb: 12.5, sg: 4.4,  na: 1,   ca: 269, fe: 3.7 },
  'cashews':         { fb: 3.3,  sg: 5.9,  na: 12,  ca: 37, fe: 6.7 },
  'oats-dry':        { fb: 10.6, sg: 1.0,  na: 2,   ca: 54, fe: 4.7 },
  'chickpeas-cooked':{ fb: 7.6,  sg: 4.8,  na: 240, ca: 49, fe: 2.9 },
  'tuna-canned-in-water':{ fb: 0, sg: 0,   na: 320, ch: 30, ca: 11, fe: 1.0 },
  'banana':          { fb: 2.6,  sg: 12.2, na: 1,   ca: 5,  fe: 0.3 },
  'apple':           { fb: 2.4,  sg: 10.4, na: 1,   ca: 6,  fe: 0.1 },
  'sugar':           { fb: 0,    sg: 100,  na: 0,   ch: 0 },
  'honey':           { fb: 0.2,  sg: 82.0, na: 4,   ch: 0 },
};

/* Give every seed food a stable id derived from its name, and fold in
   whatever micronutrients we have for it. */
SEED_FOODS.forEach(f => {
  const slug = f.n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  f.id = 'seed:' + slug;
  f.src = 'seed';
  Object.assign(f, SEED_MICROS[slug] || {});
});
