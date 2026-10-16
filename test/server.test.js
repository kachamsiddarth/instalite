const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { after, before, test } = require('node:test');
const app = require('../server');

let server;
let baseUrl;

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test('Express serves the Supabase-enabled page and frontend assets', async () => {
  const pageResponse = await fetch(`${baseUrl}/`);
  const page = await pageResponse.text();
  const stylesheetResponse = await fetch(`${baseUrl}/style.css`);
  const appScriptResponse = await fetch(`${baseUrl}/supabase-app.js`);
  const configResponse = await fetch(`${baseUrl}/api/config`);

  assert.equal(pageResponse.status, 200);
  assert.match(page, /type="module" src="\/supabase-app\.js"/);
  assert.match(page, /id="auth-form"/);
  assert.match(page, /id="create-post-form"/);
  assert.match(page, /id="theme-toggle"/);
  assert.match(page, /id="theme-toggle-mobile"/);
  assert.match(page, /localStorage\.getItem\('instalite-theme'\)/);
  assert.equal(stylesheetResponse.status, 200);
  assert.equal(appScriptResponse.status, 200);
  assert.equal(configResponse.status, 200);
  const config = await configResponse.json();
  assert.equal(typeof config.url, 'string');
  assert.equal(typeof config.anonKey, 'string');

  const appScript = await appScriptResponse.text();
  assert.match(appScript, /supabase\.auth/);
  assert.match(appScript, /onAuthStateChange\(\(_event, session\) => updateSignedInProfile\(session\?\.user\)\);/);
  assert.doesNotMatch(appScript, /Unable to read the InstaLite sign-in state/);
  assert.match(appScript, /postgres_changes/);
  assert.match(appScript, /storage\.from\('post-images'\)/);
  assert.match(appScript, /credential\.session\?\.user/);
  assert.match(appScript, /supabase\.auth\.getUser\(\)/);
  assert.match(appScript, /authenticatedUser\.id/);
  assert.match(appScript, /Confirm your email, then sign in to share a post/);
  assert.match(appScript, /Supabase has temporarily limited signup emails/);
  assert.match(appScript, /configure custom SMTP or review Authentication rate limits/);
  assert.match(appScript, /getAuthErrorMessage\(error, authMode\)/);
  assert.match(appScript, /row-level security enabled/);
  assert.match(appScript, /from\('posts'\)/);
  assert.match(appScript, /initializeTheme\(\)/);
  assert.match(appScript, /instalite-theme/);
  assert.match(appScript, /data-theme/);
  assert.doesNotMatch(appScript, /fetch\(['"]\/api\/posts/);

  const stylesheet = await stylesheetResponse.text();
  assert.match(stylesheet, /:root\[data-theme="dark"\]/);
  assert.match(stylesheet, /\.theme-toggle/);
});

test('The server no longer exposes the removed in-memory posts API', async () => {
  const response = await fetch(`${baseUrl}/api/posts`);

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: 'Not found' });
});

test('Supabase schema requires authenticated post creation and owner-scoped photo uploads', async () => {
  const schema = await fs.readFile(path.join(__dirname, '..', 'supabase', 'schema.sql'), 'utf8');

  assert.match(schema, /enable row level security/i);
  assert.match(schema, /auth\.uid\(\)\) = user_id/);
  assert.match(schema, /post-images/);
  assert.match(schema, /storage\.foldername\(name\).*auth\.uid/);
  assert.match(schema, /from pg_publication_tables[\s\S]*tablename = 'posts'[\s\S]*alter publication supabase_realtime add table public\.posts/i);
});

test('Supabase schema supports one like per user with owner-scoped unlike', async () => {
  const schema = await fs.readFile(path.join(__dirname, '..', 'supabase', 'schema.sql'), 'utf8');

  assert.match(schema, /create table if not exists public\.post_likes/);
  assert.match(schema, /primary key \(post_id, user_id\)/);
  assert.match(schema, /"Likes are publicly readable" on public\.post_likes for select/);
  assert.match(schema, /"Users can unlike their own likes" on public\.post_likes for delete/);
  assert.match(schema, /alter publication supabase_realtime add table public\.post_likes/);
});

test('Frontend wires like and unlike actions to the post_likes table', async () => {
  const appScript = await fs.readFile(path.join(__dirname, '..', 'public', 'supabase-app.js'), 'utf8');

  assert.match(appScript, /from\('post_likes'\)/);
  assert.match(appScript, /togglePostLike\(post\.id\)/);
  assert.match(appScript, /data-post-id/);
  assert.match(appScript, /aria-pressed/);
  assert.match(appScript, /Sign in to like posts/);
});

test('Supabase schema supports validated public comments with owner deletes', async () => {
  const schema = await fs.readFile(path.join(__dirname, '..', 'supabase', 'schema.sql'), 'utf8');

  assert.match(schema, /create table if not exists public\.post_comments/);
  assert.match(schema, /char_length\(body\) between 1 and 300/);
  assert.match(schema, /"Comments are publicly readable" on public\.post_comments for select/);
  assert.match(schema, /"Signed-in users can comment" on public\.post_comments for insert/);
  assert.match(schema, /"Users can delete their own comments" on public\.post_comments for delete/);
  assert.match(schema, /alter publication supabase_realtime add table public\.post_comments/);
});

test('Supabase schema derives comment author names server-side', async () => {
  const schema = await fs.readFile(path.join(__dirname, '..', 'supabase', 'schema.sql'), 'utf8');

  assert.match(schema, /create or replace function public\.set_post_comment_username\(\)/);
  assert.match(schema, /security definer/);
  assert.match(schema, /auth\.jwt\(\)/);
  assert.match(schema, /app_metadata/);
  assert.doesNotMatch(schema, /jwt_claims -> 'user_metadata'/);
  assert.match(schema, /NEW\.username := derived_name/);
  assert.match(schema, /create trigger set_post_comment_username/);
  assert.match(schema, /before insert on public\.post_comments/);
});

test('Supabase schema keeps saved posts out of the realtime publication', async () => {
  const schema = await fs.readFile(path.join(__dirname, '..', 'supabase', 'schema.sql'), 'utf8');

  assert.match(schema, /alter publication supabase_realtime drop table public\.saved_posts/);
  assert.doesNotMatch(schema, /alter publication supabase_realtime add table public\.saved_posts/);
  assert.doesNotMatch(schema, /alter table public\.saved_posts replica identity full/);
  assert.match(schema, /alter publication supabase_realtime add table public\.post_comments/);
});

test('Frontend wires comment reading and posting to the post_comments table', async () => {
  const appScript = await fs.readFile(path.join(__dirname, '..', 'public', 'supabase-app.js'), 'utf8');
  const commentInsert = appScript.slice(
    appScript.indexOf('async function submitPostComment'),
    appScript.indexOf('const postSavedState'),
  );

  assert.match(appScript, /from\('post_comments'\)/);
  assert.match(appScript, /submitPostComment\(post\.id/);
  assert.match(appScript, /maximumCommentLength/);
  assert.match(appScript, /post-card__comment-form/);
  assert.match(appScript, /Sign in to comment on posts/);
  assert.match(appScript, /set_post_comment_username/);
  assert.match(commentInsert, /username: 'instalite-user'/);
  assert.doesNotMatch(commentInsert, /user_metadata/);
});

test('Supabase schema keeps saved posts private to their owner', async () => {
  const schema = await fs.readFile(path.join(__dirname, '..', 'supabase', 'schema.sql'), 'utf8');

  assert.match(schema, /create table if not exists public\.saved_posts/);
  assert.match(schema, /primary key \(post_id, user_id\)/);
  assert.match(schema, /"Users can read their own saved posts" on public\.saved_posts for select/);
  assert.match(schema, /"Users can save posts" on public\.saved_posts for insert/);
  assert.match(schema, /"Users can unsave their own posts" on public\.saved_posts for delete/);
  assert.doesNotMatch(schema, /publicly readable" on public\.saved_posts/);
});

test('Frontend wires save and unsave actions with a private saved view', async () => {
  const appScript = await fs.readFile(path.join(__dirname, '..', 'public', 'supabase-app.js'), 'utf8');
  const page = await fs.readFile(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

  assert.match(appScript, /from\('saved_posts'\)/);
  assert.match(appScript, /togglePostSaved\(post\.id\)/);
  assert.match(appScript, /setSavedOnlyView/);
  assert.match(appScript, /Sign in to save posts/);
  assert.match(page, /id="saved-posts-link"/);
});

test('Frontend loads exact per-post like counts', async () => {
  const appScript = await fs.readFile(path.join(__dirname, '..', 'public', 'supabase-app.js'), 'utf8');
  const bulkLoader = appScript.slice(
    appScript.indexOf('async function refreshVisiblePostLikes'),
    appScript.indexOf('let likedIds = new Set();'),
  );

  assert.match(bulkLoader, /count: 'exact', head: true/);
  assert.match(bulkLoader, /\.eq\('post_id', postId\)/);
  assert.doesNotMatch(bulkLoader, /\.in\('post_id', postIds\)/);
});

test('Frontend keeps failed comments in the input and closes the viewer on backdrop clicks', async () => {
  const appScript = await fs.readFile(path.join(__dirname, '..', 'public', 'supabase-app.js'), 'utf8');

  assert.match(appScript, /const posted = await submitPostComment\(post\.id, commentInput\.value\)/);
  assert.match(appScript, /if \(posted\) \{\s+commentInput\.value = '';/);
  assert.match(appScript, /return true;/);
  assert.match(appScript, /event\.target === event\.currentTarget/);
});

test('Frontend removes realtime channels via removeChannel, not callables', async () => {
  const appScript = await fs.readFile(path.join(__dirname, '..', 'public', 'supabase-app.js'), 'utf8');
  const listener = appScript.slice(
    appScript.indexOf('function removeFeedChannels'),
    appScript.indexOf('async function refreshVisiblePostSaved'),
  );

  assert.match(listener, /supabase\.removeChannel\(channel\)/);
  assert.match(appScript, /let postsChannel;/);
  assert.match(appScript, /let likesChannel;/);
  assert.match(appScript, /let commentsChannel;/);
  assert.match(appScript, /let savedChannel;/);
  assert.doesNotMatch(appScript, /unsubscribePosts\?\.\(\)/);
  assert.doesNotMatch(appScript, /unsubscribeLikes\?\.\(\)/);
  assert.doesNotMatch(appScript, /unsubscribeComments\?\.\(\)/);
  assert.doesNotMatch(appScript, /unsubscribeSaved\?\.\(\)/);
});

test('Theme init marks toggles ready after wiring handlers', async () => {
  const appScript = await fs.readFile(path.join(__dirname, '..', 'public', 'supabase-app.js'), 'utf8');
  const spec = await fs.readFile(path.join(__dirname, 'app.spec.js'), 'utf8');

  assert.match(appScript, /data-theme-ready/);
  assert.match(spec, /data-theme-ready/);
});

test('Story circles open a viewer with navigation and close controls', async () => {
  const page = await fs.readFile(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const appScript = await fs.readFile(path.join(__dirname, '..', 'public', 'supabase-app.js'), 'utf8');
  const stylesheet = await fs.readFile(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');

  assert.match(page, /id="story-viewer"/);
  assert.match(page, /data-story-index="0"/);
  assert.match(page, /id="story-viewer-prev"/);
  assert.match(page, /id="story-viewer-next"/);
  assert.match(page, /id="close-story-viewer"/);
  assert.match(appScript, /openStoryViewer\(/);
  assert.match(appScript, /stepStoryViewer\(/);
  assert.match(appScript, /ArrowRight/);
  assert.match(appScript, /initializeStoryViewer\(\)/);
  assert.match(stylesheet, /\.story-viewer/);
});
