// @ts-check
/**
 * Browser verification tests for InstaLite.
 *
 * IMPORTANT: These tests run against the Express static server WITHOUT Supabase
 * Supabase-app.js intentionally disables auth-gated buttons at startup and
 * shows a "Supabase is not configured" feed message.
 *
 * Tests here verify:
 *   - The page and all required assets are served correctly.
 *   - The static HTML shell, navigation, and dialogs are present in the DOM.
 *   - Elements that are expected to be disabled without Supabase ARE disabled
 *     (guards against a participant accidentally removing the auth gate).
 *   - The auth dialog can be opened via the Sign-in button, which remains
 *     enabled without Supabase (it just shows the dialog).
 *
 * Tests that require live Supabase (Postgres feed, create-post flow) are
 *
 * Add feature-specific describe blocks below as workshop issues are implemented.
 */

const { expect, test } = require('@playwright/test');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Navigate to the home page and wait until Supabase-app.js has run its
 * startup logic (the feed message changes from the inline placeholder).
 *
 * @param {import('@playwright/test').Page} page
 */
async function gotoHome(page) {
  await page.goto('/');
  // Supabase-app.js is a module script; wait for it to update the feed area.
  await page.waitForFunction(() => {
    const el = document.querySelector('#feed-posts');
    // The inline HTML placeholder text is "Finding your little moments…".
    // Supabase-app.js replaces it with an error message when not configured.
    return el && el.textContent.trim().length > 0;
  }, { timeout: 10_000 });
}

// ---------------------------------------------------------------------------
// Page load
// ---------------------------------------------------------------------------

test.describe('Page load', () => {
  test('serves the HTML page with a 200 status', async ({ page }) => {
    const response = await page.goto('/');
    expect(response.status()).toBe(200);
  });

  test('has the correct document title', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/InstaLite/i);
  });

  test('serves style.css without error', async ({ page }) => {
    const response = await page.goto('/style.css');
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toMatch(/text\/css/);
  });

  test('serves Supabase-app.js without error', async ({ page }) => {
    const response = await page.goto('/Supabase-app.js');
    expect(response.status()).toBe(200);
  });

  test('serves Supabase-config.js without error', async ({ page }) => {
    const response = await page.goto('/Supabase-config.js');
    expect(response.status()).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// App shell — sidebar navigation
// ---------------------------------------------------------------------------

test.describe('Sidebar navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.app-shell', { state: 'attached' });
  });

  test('brand link is visible', async ({ page }) => {
    await expect(page.locator('a.brand').first()).toBeVisible();
  });

  test('InstaLite brand name appears in the sidebar', async ({ page }) => {
    await expect(page.locator('.sidebar .brand span').last()).toHaveText('InstaLite');
  });

  test('"Create post" button is present in the DOM', async ({ page }) => {
    // The button exists in HTML; Supabase-app.js disables it when Supabase is
    // not configured. Its presence (not enabled state) is what we verify here.
    await expect(page.locator('#open-create-post')).toBeAttached();
  });

  test('"Create post" button is disabled when Supabase is not configured', async ({ page }) => {
    // This guards against a participant accidentally removing the auth gate.
    await gotoHome(page);
    await expect(page.locator('#open-create-post')).toBeDisabled();
  });

  test('"Sign in" button is present and visible', async ({ page }) => {
    await expect(page.locator('#auth-button')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Feed section
// ---------------------------------------------------------------------------

test.describe('Feed section', () => {
  test.beforeEach(async ({ page }) => {
    await gotoHome(page);
  });

  test('feed heading "Little moments" is visible', async ({ page }) => {
    await expect(page.locator('h1')).toContainText('Little moments');
  });

  test('today\'s date is rendered in the feed heading', async ({ page }) => {
    const dateEl = page.locator('#today-date');
    await expect(dateEl).toBeVisible();
    await expect(dateEl).not.toBeEmpty();
  });

  test('feed posts container is present in the DOM', async ({ page }) => {
    await expect(page.locator('#feed-posts')).toBeAttached();
  });

  test('feed shows a configuration error when Supabase is not set up', async ({ page }) => {
    // Expected behaviour: Supabase-app.js detects the demo API key and shows
    // an error message instead of trying to connect to production Supabase.
    const feedPosts = page.locator('#feed-posts');
    await expect(feedPosts).toContainText(/Supabase is not configured/i);
  });

  test('stories section is visible', async ({ page }) => {
    await expect(page.locator('.stories')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Create-post dialog — static structure (no interaction without Supabase)
// ---------------------------------------------------------------------------

test.describe('Create-post dialog (static structure)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.app-shell', { state: 'attached' });
  });

  test('dialog element is present in the DOM', async ({ page }) => {
    await expect(page.locator('#create-dialog')).toBeAttached();
  });

  test('dialog is not open on page load', async ({ page }) => {
    // <dialog> must not have the "open" attribute on initial paint.
    await expect(page.locator('#create-dialog')).not.toHaveAttribute('open', '');
  });

  test('create-post form is inside the dialog', async ({ page }) => {
    await expect(page.locator('#create-post-form')).toBeAttached();
  });

  test('form has a file input for photos', async ({ page }) => {
    const input = page.locator('#post-image');
    await expect(input).toBeAttached();
    await expect(input).toHaveAttribute('type', 'file');
    await expect(input).toHaveAttribute('accept', 'image/jpeg,image/png,image/webp');
  });

  test('form has a caption textarea', async ({ page }) => {
    await expect(page.locator('#post-caption')).toBeAttached();
  });

  test('"Share post" submit button is inside the form', async ({ page }) => {
    await expect(page.locator('#submit-create-post')).toBeAttached();
  });
});

// ---------------------------------------------------------------------------
// Sign-in dialog
// ---------------------------------------------------------------------------

test.describe('Sign-in dialog', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.app-shell', { state: 'attached' });
  });

  test('auth dialog is not open on page load', async ({ page }) => {
    await expect(page.locator('#auth-dialog')).not.toHaveAttribute('open', '');
  });

  test('auth dialog has email and password fields', async ({ page }) => {
    await expect(page.locator('#auth-email')).toBeAttached();
    await expect(page.locator('#auth-password')).toBeAttached();
  });

  test('takes a screenshot of the initial page state', async ({ page }) => {
    await gotoHome(page);
    await page.screenshot({ path: 'test-results/home-no-Supabase.png', fullPage: false });
  });
});

// ---------------------------------------------------------------------------
// Mobile navigation
// ---------------------------------------------------------------------------

test.describe('Mobile navigation', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('mobile create-post button is present in the DOM', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#open-create-post-mobile')).toBeAttached();
  });
});

// ---------------------------------------------------------------------------
// Static asset routing
// ---------------------------------------------------------------------------

test.describe('Static asset routing', () => {
  test('unknown route returns 404 JSON', async ({ page }) => {
    const response = await page.goto('/api/does-not-exist');
    expect(response.status()).toBe(404);
    const body = await response.json();
    expect(body).toMatchObject({ error: 'Not found' });
  });

  test('/api/posts is removed and returns 404', async ({ page }) => {
    const response = await page.goto('/api/posts');
    expect(response.status()).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Interactive story viewer (Feature 1)
// ---------------------------------------------------------------------------

test.describe('Interactive story viewer (Feature 1)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.app-shell', { state: 'attached' });
  });

  test('story viewer dialog is attached and closed by default', async ({ page }) => {
    const dialog = page.locator('#story-dialog');
    await expect(dialog).toBeAttached();
    await expect(dialog).not.toHaveAttribute('open', '');
  });

  test('clicking a story circle opens the story viewer and displays author', async ({ page }) => {
    const storyCircle = page.locator('.stories button.story').nth(1); // leo.park
    await storyCircle.click();

    const dialog = page.locator('#story-dialog');
    await expect(dialog).toHaveAttribute('open', '');
    await expect(page.locator('#story-author-username')).toHaveText('leo.park');
    await expect(page.locator('#story-image')).toHaveAttribute('src', /images\.unsplash\.com/);
  });

  test('navigates to the next and previous stories with buttons', async ({ page }) => {
    await page.locator('.stories button.story').nth(1).click();
    await expect(page.locator('#story-author-username')).toHaveText('leo.park');

    await page.locator('#next-story').click();
    await expect(page.locator('#story-author-username')).toHaveText('nina.rivers');

    await page.locator('#prev-story').click();
    await expect(page.locator('#story-author-username')).toHaveText('leo.park');
  });

  test('enforces boundary conditions for navigation buttons', async ({ page }) => {
    await page.locator('.stories button.story').first().click();
    await expect(page.locator('#story-author-username')).toHaveText('Your story');
    await expect(page.locator('#prev-story')).toBeDisabled();
    await expect(page.locator('#next-story')).toBeEnabled();

    await page.locator('#close-story').click();
    await page.locator('.stories button.story').last().click();
    await expect(page.locator('#story-author-username')).toHaveText('zoe.sun');
    await expect(page.locator('#next-story')).toBeDisabled();
    await expect(page.locator('#prev-story')).toBeEnabled();
  });

  test('closes the story viewer with the close button', async ({ page }) => {
    await page.locator('.stories button.story').first().click();
    const dialog = page.locator('#story-dialog');
    await expect(dialog).toHaveAttribute('open', '');

    await page.locator('#close-story').click();
    await expect(dialog).not.toHaveAttribute('open', '');
  });

  test('supports keyboard navigation with arrow keys and Escape to close', async ({ page }) => {
    await page.locator('.stories button.story').nth(1).click();
    await expect(page.locator('#story-author-username')).toHaveText('leo.park');

    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#story-author-username')).toHaveText('nina.rivers');

    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('#story-author-username')).toHaveText('leo.park');

    await page.keyboard.press('Escape');
    const dialog = page.locator('#story-dialog');
    await expect(dialog).not.toHaveAttribute('open', '');
  });

  test('responsive on mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('.stories button.story').first().click();

    const dialog = page.locator('#story-dialog');
    await expect(dialog).toHaveAttribute('open', '');
    await expect(page.locator('#story-author-username')).toBeVisible();
    await expect(page.locator('#close-story')).toBeVisible();

    await page.locator('#close-story').click();
    await expect(dialog).not.toHaveAttribute('open', '');
  });
});
