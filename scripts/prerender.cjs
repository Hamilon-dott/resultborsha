const fs = require('fs');
const path = require('path');

const distDir = path.join(__dirname, '..', 'dist');
const indexHtmlPath = path.join(distDir, 'index.html');

if (!fs.existsSync(indexHtmlPath)) {
  console.error('[Prerender] Error: dist/index.html does not exist. Run vite build first.');
  process.exit(1);
}

const baseHtml = fs.readFileSync(indexHtmlPath, 'utf8');

const pages = [
  {
    slug: 'hsc-result-2026',
    tabId: 'tab-hsc-result',
    title: 'HSC Result 2026 Marksheet with Number - Education Board Result | eboardresults',
    description: 'Check Bangladesh Education Board HSC Result 2026 online with detailed marksheet, subject-wise numbers, GPA, and college admission guidelines.',
    breadcrumbName: 'HSC Result 2026'
  },
  {
    slug: 'check-result-guide',
    tabId: 'tab-check-guide',
    title: 'How to Check Education Board Result 2026 Online - Step by Step Guide | eboardresults',
    description: 'Complete step-by-step guideline on how to check Bangladesh Education Board Result 2026 online with roll and registration number.',
    breadcrumbName: 'Check Result Guide'
  },
  {
    slug: 'ssc-result-2026',
    tabId: 'tab-ssc-result',
    title: 'SSC Result 2026 Marksheet with Number - Education Board Result | eboardresults',
    description: 'Check Bangladesh SSC Result 2026 & Dakhil Result online. Download paperless full marksheet with subject-wise detailed numbers.',
    breadcrumbName: 'SSC Result 2026'
  },
  {
    slug: 'marksheet-with-numbers',
    tabId: 'tab-marksheet',
    title: 'Education Board Marksheet with Number 2026 - Subject Wise Marks Breakdown | eboardresults',
    description: 'Get detailed subject-wise marksheet with numbers for HSC, SSC, Dakhil, and Alim examinations 2026. View theoretical, MCQ, and practical scores.',
    breadcrumbName: 'Marksheet with Number'
  },
  {
    slug: 'sms-result-system',
    tabId: 'tab-sms-service',
    title: 'SMS Result System 2026 - How to Check HSC & SSC Result via SMS 16222 | eboardresults',
    description: 'Learn how to get HSC Result 2026 and SSC Result via mobile SMS code to 16222 from Teletalk, Grameenphone, Robi, Airtel, and Banglalink.',
    breadcrumbName: 'SMS Result System'
  },
  {
    slug: 'dhaka-board-result',
    tabId: 'tab-dhaka-board',
    title: 'Dhaka Board Result 2026 - HSC & SSC Marksheet with Number | eboardresults',
    description: 'Official Dhaka Education Board HSC Result 2026 and SSC Result online with subject-wise marksheet, GPA, and college admission merit list.',
    breadcrumbName: 'Dhaka Board Result'
  },
  {
    slug: 'rajshahi-board-result',
    tabId: 'tab-rajshahi-board',
    title: 'Rajshahi Board Result 2026 - HSC & SSC Marksheet with Number | eboardresults',
    description: 'Check Board of Intermediate and Secondary Education Rajshahi HSC Result 2026 and SSC Result online with subject-wise numbers.',
    breadcrumbName: 'Rajshahi Board Result'
  },
  {
    slug: 'chittagong-board-result',
    tabId: 'tab-chittagong-board',
    title: 'Chittagong Board Result 2026 - HSC & SSC Marksheet with Number | eboardresults',
    description: 'Official Chittagong Education Board HSC Result 2026 and SSC Result with full subject-wise marksheet, numbers, and GPA.',
    breadcrumbName: 'Chittagong Board Result'
  },
  {
    slug: 'comilla-board-result',
    tabId: 'tab-comilla-board',
    title: 'Comilla Board Result 2026 - HSC & SSC Marksheet with Number | eboardresults',
    description: 'Check Comilla Education Board HSC Result 2026 and SSC Result online with full subject marksheet and GPA breakdown.',
    breadcrumbName: 'Comilla Board Result'
  },
  {
    slug: 'barisal-board-result',
    tabId: 'tab-barisal-board',
    title: 'Barisal Board Result 2026 - HSC & SSC Marksheet with Number | eboardresults',
    description: 'Barisal Education Board HSC Result 2026 and SSC Result online with detailed marksheet with numbers and grading info.',
    breadcrumbName: 'Barisal Board Result'
  },
  {
    slug: 'sylhet-board-result',
    tabId: 'tab-sylhet-board',
    title: 'Sylhet Board Result 2026 - HSC & SSC Marksheet with Number | eboardresults',
    description: 'Sylhet Education Board HSC Result 2026 and SSC Result online. Instant access to subject-wise marks and GPA.',
    breadcrumbName: 'Sylhet Board Result'
  },
  {
    slug: 'jessore-board-result',
    tabId: 'tab-jessore-board',
    title: 'Jessore Board Result 2026 - HSC & SSC Marksheet with Number | eboardresults',
    description: 'Check Jessore Board HSC Result 2026 and SSC Result online with full subject numbers, CQ, MCQ, and practical breakdown.',
    breadcrumbName: 'Jessore Board Result'
  },
  {
    slug: 'dinajpur-board-result',
    tabId: 'tab-dinajpur-board',
    title: 'Dinajpur Board Result 2026 - HSC & SSC Marksheet with Number | eboardresults',
    description: 'Dinajpur Education Board HSC Result 2026 and SSC Result online with subject-wise marksheet and GPA 5 list.',
    breadcrumbName: 'Dinajpur Board Result'
  },
  {
    slug: 'mymensingh-board-result',
    tabId: 'tab-mymensingh-board',
    title: 'Mymensingh Board Result 2026 - HSC & SSC Marksheet with Number | eboardresults',
    description: 'Mymensingh Education Board HSC Result 2026 and SSC Result online. Fast web-based result publication system.',
    breadcrumbName: 'Mymensingh Board Result'
  },
  {
    slug: 'madrasah-board-result',
    tabId: 'tab-madrasah-board',
    title: 'Madrasah Board Result 2026 - Alim & Dakhil Marksheet with Number | eboardresults',
    description: 'Bangladesh Madrasah Education Board (BMEB) Alim Result 2026 and Dakhil Result online with full subject-wise numbers.',
    breadcrumbName: 'Madrasah Board Result'
  },
  {
    slug: 'technical-board-result',
    tabId: 'tab-technical-board',
    title: 'Technical Board Result 2026 - HSC BM, Vocational & Diploma Result | eboardresults',
    description: 'Bangladesh Technical Education Board (BTEB) HSC Vocational, HSC BM, and SSC Vocational Result 2026 marksheet with number.',
    breadcrumbName: 'Technical Board Result'
  },
  {
    slug: 'grading-gpa-system',
    tabId: 'tab-grading-system',
    title: 'Education Board Grading & GPA System Bangladesh - Marks Distribution Table | eboardresults',
    description: 'Understand Bangladesh education board grading system, GPA calculation formula (A+, A, A-, B, C, D, F), and 4th subject rule.',
    breadcrumbName: 'Grading & GPA System'
  },
  {
    slug: 'board-challenge-rescrutiny',
    tabId: 'tab-board-challenge',
    title: 'Board Challenge & Rescrutiny Application System 2026 - Khata Challenge via SMS | eboardresults',
    description: 'How to apply for Education Board Result Board Challenge (Khata Re-check / Rescrutiny) 2026 via Teletalk SMS and check challenged results.',
    breadcrumbName: 'Board Challenge Rescrutiny'
  },
  {
    slug: 'institution-eiin-result',
    tabId: 'tab-institution-result',
    title: 'Institution EIIN Wise Result 2026 - Download School & College Result Sheet | eboardresults',
    description: 'Download institute-wise PDF result sheet and analytics using 6-digit EIIN number for all schools and colleges in Bangladesh.',
    breadcrumbName: 'Institution EIIN Result'
  },
  {
    slug: 'conclusion-summary',
    tabId: 'tab-conclusion',
    title: 'Education Board Result 2026 Summary, Statistics & Official Helplines | eboardresults',
    description: 'Nationwide education board result statistics, pass percentage, board contact details, and emergency support helplines.',
    breadcrumbName: 'Result Summary & Helplines'
  }
];

console.log(`[Prerender] Generating static HTML pages for ${pages.length} slugs...`);

pages.forEach((page) => {
  let html = baseHtml;
  const canonicalUrl = `https://result.talukdaracademy.com.bd/${page.slug}`;

  // 1. Update Title tag
  html = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${page.title}</title>`);

  // 2. Update Meta Description
  html = html.replace(/<meta\s+name=["']description["']\s+content=["'][\s\S]*?["']\s*\/?>/i, `<meta name="description" content="${page.description}">`);

  // 3. Update Canonical link (SELF-REFERENCING per slug)
  html = html.replace(/<link\s+rel=["']canonical["']\s+href=["'][\s\S]*?["']\s*\/?>/i, `<link rel="canonical" href="${canonicalUrl}" />`);

  // 4. Update OpenGraph Tags
  html = html.replace(/<meta\s+property=["']og:title["']\s+content=["'][\s\S]*?["']\s*\/?>/i, `<meta property="og:title" content="${page.title}">`);
  html = html.replace(/<meta\s+property=["']og:description["']\s+content=["'][\s\S]*?["']\s*\/?>/i, `<meta property="og:description" content="${page.description}">`);
  html = html.replace(/<meta\s+property=["']og:url["']\s+content=["'][\s\S]*?["']\s*\/?>/i, `<meta property="og:url" content="${canonicalUrl}">`);

  // 5. Update Twitter Card Tags
  html = html.replace(/<meta\s+name=["']twitter:title["']\s+content=["'][\s\S]*?["']\s*\/?>/i, `<meta name="twitter:title" content="${page.title}">`);
  html = html.replace(/<meta\s+name=["']twitter:description["']\s+content=["'][\s\S]*?["']\s*\/?>/i, `<meta name="twitter:description" content="${page.description}">`);

  // 6. Inject Breadcrumb Schema before closing head
  const breadcrumbSchema = `
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": [
      {
        "@type": "ListItem",
        "position": 1,
        "name": "Home",
        "item": "https://result.talukdaracademy.com.bd/"
      },
      {
        "@type": "ListItem",
        "position": 2,
        "name": "${page.breadcrumbName}",
        "item": "${canonicalUrl}"
      }
    ]
  }
  </script>
`;
  html = html.replace('</head>', `${breadcrumbSchema}\n</head>`);

  // 7. Update Active Tab in Content
  // Ensure default tab-pane-content has active removed
  html = html.replace(/class="tab-pane-content active"/g, 'class="tab-pane-content"');
  // Make target tab active
  html = html.replace(
    new RegExp(`class="tab-pane-content"\\s+id="${page.tabId}"`, 'g'),
    `class="tab-pane-content active" id="${page.tabId}"`
  );

  // 8. Update Active Sidebar Button
  html = html.replace(/class="sidebar-tab-btn active"/g, 'class="sidebar-tab-btn"');
  html = html.replace(
    new RegExp(`class="sidebar-tab-btn"(\\s+data-tab="${page.tabId}")`, 'g'),
    `class="sidebar-tab-btn active"$1`
  );

  // Write nested directory: dist/<slug>/index.html
  const pageDir = path.join(distDir, page.slug);
  if (!fs.existsSync(pageDir)) {
    fs.mkdirSync(pageDir, { recursive: true });
  }
  fs.writeFileSync(path.join(pageDir, 'index.html'), html, 'utf8');

  // Also write flat file: dist/<slug>.html (for static hosting engines supporting cleanUrls)
  fs.writeFileSync(path.join(distDir, `${page.slug}.html`), html, 'utf8');

  console.log(`  ✓ Generated /${page.slug} (self-canonical: ${canonicalUrl})`);
});

console.log('[Prerender] Successfully generated all static slug pages!');
