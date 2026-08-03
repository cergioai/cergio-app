# CERGIO — CRAWL LISTS AND PRIORITY

**Founder-provided, 2026-08-02** (uploaded doc, recorded verbatim below). Governs which
service types and creator categories are crawled, and in what order. Committed to the
repo by SPEC-245 so the CI subagents read THIS file, not a paraphrase — a paraphrase is
not a decision.

> **PHASE 3 LIST: FORTHCOMING.** The founder will add a Phase 3 list in a few days
> (stated 2026-08-02). Do NOT invent it, extend these lists, or treat Tier 3 below as
> that list — it is a separate, future addition. Until it arrives, these lists are
> complete and exhaustive.

**Reconciliation notes (dated):**
- The paid rota below names **yelp**; yelp is currently **PAUSED** by founder order
  (2026-08-02: "don't delete yelp.. just pause as a source"). It keeps its rota slot
  and is skipped while paused (gate #239).
- 2026-08-03: ALL sources (minus yelp) are active with a 100-lead-per-source audit cap
  (SPEC-243, gate #243). These lists set the crawl order within that.
- Encoded by SPEC-245: `scripts/_growth-scope.mjs` TYPES_T1/T2/T3 (services, seeded in
  tier order) and `supabase/functions/creator-harvest/index.ts` NICHE_TIERS (creators,
  rotated tier-first). TARGET_CATEGORIES is DERIVED from the niches so a category can
  never be quarantined by the SPEC-86b cleanup while its niche is being harvested.

---

Cities: **NYC** and **Miami**. Identical lists for both.

## SERVICES — Tier 1 (crawl first, in this order)

1.  personal trainer
2.  dog walker
3.  dog trainer
4.  babysitter
5.  house cleaning
6.  handyman
7.  hair stylist
8.  photographer
9.  tutor
10. mover
11. pet sitter
12. home organizer

## SERVICES — Tier 2 (after Tier 1 is exhausted)

13. nutritionist
14. life coach
15. personal assistant
16. driver
17. housekeeper
18. plumber
19. electrician
20. contractor
21. painter
22. landscaping
23. locksmith
24. appliance repair
25. window cleaning
26. pressure washing
27. junk removal
28. barber

## SERVICES — Tier 3, full ontology (after Tier 2 is exhausted)

29. carpet cleaning
30. upholstery cleaning
31. gutter cleaning
32. roof repair
33. HVAC
34. air duct cleaning
35. pest control
36. pool cleaning
37. tile and grout
38. drywall repair
39. flooring
40. carpentry
41. furniture assembly
42. tv mounting
43. smart home installation
44. car detailing
45. mobile mechanic
46. bike repair
47. computer repair
48. phone repair
49. laundry and dry cleaning pickup
50. errand runner
51. senior companion
52. night nurse
53. postpartum doula
54. newborn care specialist
55. nanny
56. after-school care
57. music teacher
58. language tutor
59. test prep tutor
60. swim instructor
61. tennis coach
62. golf coach
63. yoga instructor
64. pilates instructor
65. run coach
66. physical therapist
67. sports massage — **BLOCKED**
68. stretch therapist
69. meal prep
70. private chef — **BLOCKED**
71. bartender for hire
72. event server
73. event planner
74. wedding planner
75. florist
76. videographer
77. photo booth
78. DJ — **BLOCKED**
79. live musician
80. balloon and decor
81. face painter
82. kids entertainer
83. pet groomer
84. mobile vet
85. dog boarding
86. cat sitter
87. aquarium maintenance
88. plant care
89. interior designer
90. home stager
91. closet designer
92. handywoman
93. junk hauling
94. moving labor
95. packing service
96. storage organizer
97. estate cleanout
98. pressure wash driveway
99. window tinting
100. solar panel cleaning
101. holiday lighting
102. snow removal
103. lawn mowing
104. tree trimming
105. irrigation repair
106. fence repair
107. deck staining
108. garage door repair
109. locksmith emergency
110. security camera install
111. notary
112. bookkeeper
113. tax preparer
114. resume writer
115. career coach
116. business coach
117. social media manager
118. web designer
119. brand photographer
120. makeup artist — **BLOCKED**
121. hair braider
122. barber home visit
123. nail technician
124. lash technician
125. brow artist
126. spray tan
127. personal stylist
128. tailor and alterations
129. shoe repair
130. dry cleaner delivery

**BLOCKED — never crawled or surfaced at any tier:** massage · tattoo · makeup · personal chef · surgery · drugs · alcohol · tobacco · gambling · firearms · adult · nightclub-DJ

## CREATORS — Tier 1 categories (crawl first, in this order)

1.  pets
2.  parenting
3.  fitness
4.  home
5.  beauty
6.  local city life

## CREATORS — Tier 2 categories (after Tier 1 is exhausted)

7.  food
8.  wellness
9.  style
10. photography
11. events
12. neighbourhood accounts

## CREATORS — Tier 3, full ontology (after Tier 2 is exhausted)

13. dog breeds — specific
14. cat owners
15. small pets and exotics
16. new mums
17. dads
18. toddler activities
19. school-age parenting
20. special needs parenting
21. home workouts
22. running
23. cycling
24. yoga
25. pilates
26. strength training
27. marathon and endurance
28. nutrition and meal prep
29. plant-based
30. supplements
31. mental health and mindfulness
32. sleep and recovery
33. home renovation
34. interiors
35. small space living
36. rentals and first apartments
37. organisation and decluttering
38. cleaning
39. DIY and repair
40. gardening and plants
41. skincare
42. haircare
43. natural hair
44. nails
45. lashes and brows
46. mens grooming
47. fashion and thrift
48. sustainable living
49. budget living
50. local food and restaurants
51. coffee
52. nightlife — **BLOCKED**
53. events and things to do
54. neighbourhood guides
55. moving to the city
56. expat and newcomer
57. student life
58. dating and social
59. weddings
60. baby showers and parties
61. photography and content
62. videography
63. side hustle and freelance
64. small business owners
65. real estate
66. cars
67. travel — local weekends
68. beaches and outdoors
69. sports fans
70. pet rescue and adoption

**BLOCKED for creators:** nightlife/club promotion · adult · gambling · alcohol brands · tobacco/vape · firearms

## CRAWL ORDER

For each city, for each type in tier order:

1.  **osm** first — free.
2.  Then the paid rota: craigslist · yellowpages_apify · yelp · google_lsa · gmaps_apify · ig_services.
3.  Park any source under 40% contactable for that type.
4.  Move to the next type when the current one is exhausted.
5.  Both cities reach quota before any new geography opens.
