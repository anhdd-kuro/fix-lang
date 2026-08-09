/**
 * @file detectSecrets.test.ts
 * @description Rule-by-rule coverage for the secret detector.
 *
 * Every sample here is either a vendor-published documentation example
 * (`AKIA` + `IOSFODNN7EXAMPLE`, AWS's `wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY`,
 * jwt.io's canonical token, RFC 7617's `Aladdin:open sesame`, Stripe's docs
 * keys) or an obviously-fake value built to be structurally real. Nothing here
 * is or ever was a live credential.
 */
import { describe, expect, it } from "vitest";
import { isFullyMaskable, scanForSecrets, type SecretMatch } from "./detectSecrets";
import {
  CREDENTIAL_NAME_SEGMENTS,
  MAX_CREDENTIAL_VALUE_LENGTH,
  SECRET_RULES,
  isCredentialName,
  type SecretRuleId,
} from "./secretRules";

/**
 * Fixtures are assembled from parts so no complete credential-shaped literal
 * appears in this file's source text. GitHub push protection matches contiguous
 * literals; every value below is fabricated, but the scanner cannot know that.
 * The joined value is byte-identical to what it replaced.
 */
const credentialFixture = (...parts: readonly string[]): string => parts.join("");

const AWS_DOC_ACCESS_KEY_ID = credentialFixture("AKIA", "IOSFODNN7EXAMPLE");
const AWS_DOC_SECRET_ACCESS_KEY = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
const JWT_IO_CANONICAL =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
const RFC7617_BASIC = "QWxhZGRpbjpvcGVuIHNlc2FtZQ==";
const GITHUB_DOC_PAT = credentialFixture("ghp_", "16C7e42F292c6912E7710c838347Ae178B4a");
const STRIPE_DOC_TEST_KEY = credentialFixture("sk_test_", "4eC39HqLyjWDarjtT1zdp7dc");
const STRIPE_DOC_PUBLISHABLE_KEY = "pk_live_TYooMQauvdEDq54NiTphI7jx";

const ANTHROPIC_API03_KEY = credentialFixture(
  "sk-ant-api03-",
  "EXAMPLEfakekeymaterial0123456789abcdefgh-AAAAAA",
);
const ANTHROPIC_API03_KEY_PROSE = credentialFixture(
  "sk-ant-api03-",
  "anotherEXAMPLEfakevalue0123456789abcd",
);
const ANTHROPIC_API03_TOO_SHORT = credentialFixture("sk-ant-api03-", "tooshort");

const OPENROUTER_V1_KEY = credentialFixture(
  "sk-or-v1-",
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
);
const OPENROUTER_V1_KEY_PROSE = credentialFixture(
  "sk-or-v1-",
  "EXAMPLEfakeopenrouterkeymaterial0123456789",
);
const OPENROUTER_V1_KEY_ASSIGNED = credentialFixture(
  "sk-or-v1-",
  "abcdefabcdefabcdefabcdefabcdefabcdef1234",
);

const GITHUB_OAUTH_TOKEN = credentialFixture("gho_", "16C7e42F292c6912E7710c838347Ae178B4a");
const GITHUB_PAT_TOO_SHORT = credentialFixture("ghp_", "shortvalue");

const SLACK_BOT_TOKEN = credentialFixture(
  "xoxb-",
  "2401234567890-2401234567891-fakeSlackTokenValue123",
);
const SLACK_USER_TOKEN = credentialFixture(
  "xoxp-",
  "2401234567890-2401234567891-fakeUserTokenValue",
);

const GOOGLE_API_KEY_BROWSER = credentialFixture("AIza", "SyD_EXAMPLEfakegooglekey12345678901");
const GOOGLE_API_KEY_PROSE = credentialFixture("AIza", "SyB-EXAMPLEfakegooglekey09876543210");
const GOOGLE_API_KEY_QUERY = credentialFixture("AIza", "SyC_EXAMPLEfakegooglekeyABCDEFGHIJ0");
const GOOGLE_API_KEY_TRUNCATED = credentialFixture("AIza", "SyD_EXAMPLEfakegooglekey1234567890");

const GITLAB_PAT = credentialFixture("glpat-", "EXAMPLEfakeToken1234");
const GITLAB_PAT_PROSE = credentialFixture("glpat-", "EXAMPLEfakeSecondToken99");
const GITLAB_PAT_UNDERSCORES = credentialFixture("glpat-", "EXAMPLE_fake_third_token_1");

const STRIPE_LIVE_SECRET_KEY = credentialFixture("sk_live_", "EXAMPLEfake1234567890");
const STRIPE_RESTRICTED_KEY = credentialFixture("rk_live_", "EXAMPLEfake1234567890");

const NPM_CLASSIC_TOKEN = credentialFixture("npm_", "EXAMPLEfakeNpmToken1234567890abcdefg");
const NPM_TOKEN_NPMRC = credentialFixture("npm_", "ANOTHERfakeNpmToken1234567890abcde00");
const NPM_TOKEN_PROSE = credentialFixture("npm_", "THIRDfakeNpmTokenValue1234567890abcd");
const NPM_TOKEN_TOO_SHORT = credentialFixture("npm_", "shorttoken");
const NPM_CONFIG_REGISTRY_LOOKALIKE = credentialFixture("npm_", "config_registry");

const SHOPIFY_ADMIN_TOKEN = credentialFixture("shpat_", "0123456789abcdef0123456789abcdef");
const SHOPIFY_TOKEN_TOO_SHORT = credentialFixture("shpat_", "notlongenough");

const DIGITALOCEAN_TOKEN_TOO_SHORT = credentialFixture("dop_v1_", "0123456789abcdef");

const AWS_ACCESS_KEY_TOO_LONG = credentialFixture("AKIA", "IOSFODNN7EXAMPLETOOLONGTOBEANID");

const PEM_BODY = [
  "MIIBOgIBAAJBAKj34GkxFhD90vcNLYLInFEX6Ppy1tPf9Cnzj4p4WGeKLs1Pt8Qu",
  "KUpRKfFLfRYC9AIKjbJTWit+CqvjWYzvQwECAwEAAQJAIJLixBy2qpFoS4DSmoEm",
].join("\n");

const pemBlock = (label: string): string =>
  `-----BEGIN ${label} PRIVATE KEY-----\n${PEM_BODY}\n-----END ${label} PRIVATE KEY-----`;

/**
 * `gpg --export-secret-keys --armor` writes `PRIVATE KEY BLOCK-----`, not
 * `PRIVATE KEY-----`. Obviously-fake armor body.
 */
const PGP_BODY = [
  "lQOYBGEXAMPLEfakepgpsecretkeyblockbodyAAAABBBBCCCCDDDDEEEEFFFF00",
  "GGGGfakeArmorBodyForTheDocumentationExampleBlockHHHHIIIIJJJJ1234",
].join("\n");

const PGP_PRIVATE_KEY_BLOCK = `-----BEGIN PGP PRIVATE KEY BLOCK-----\n\n${PGP_BODY}\n-----END PGP PRIVATE KEY BLOCK-----`;

type ScanOptions = { highEntropyRule?: boolean };

type PositiveCase = {
  ruleId: SecretRuleId;
  description: string;
  text: string;
  /** The exact substring a kept match must span. */
  secret: string;
  options?: ScanOptions;
};

type NegativeCase = {
  ruleId: SecretRuleId;
  description: string;
  text: string;
  options?: ScanOptions;
};

const POSITIVES: readonly PositiveCase[] = [
  {
    ruleId: "private-key-block",
    description: "a terminated RSA block",
    text: `Here is the deploy key:\n${pemBlock("RSA")}\nrotate it tomorrow.`,
    secret: pemBlock("RSA"),
  },
  {
    ruleId: "private-key-block",
    description: "a terminated OPENSSH block",
    text: pemBlock("OPENSSH"),
    secret: pemBlock("OPENSSH"),
  },
  {
    ruleId: "private-key-block",
    description: "a terminated EC block",
    text: `before\n${pemBlock("EC")}\nafter`,
    secret: pemBlock("EC"),
  },
  {
    ruleId: "private-key-block",
    description: "a terminated PGP block, the shape `gpg --export-secret-keys --armor` writes",
    text: `here it is\n${PGP_PRIVATE_KEY_BLOCK}\nrotate it`,
    secret: PGP_PRIVATE_KEY_BLOCK,
  },
  {
    ruleId: "url-credentials",
    description: "a postgres connection string",
    text: "DATABASE_URL is postgres://admin:s3cr3tP4ss@db.internal:5432/app today",
    secret: "s3cr3tP4ss",
  },
  {
    ruleId: "url-credentials",
    description: "a mongodb+srv connection string",
    text: "mongodb+srv://svcuser:Pa55w0rdRotate@cluster0.example.net/test",
    secret: "Pa55w0rdRotate",
  },
  {
    ruleId: "url-credentials",
    description: "an ftp url",
    text: "ftp://deploy:R3leasePass!@files.example.com/drop",
    secret: "R3leasePass!",
  },
  {
    ruleId: "url-credentials",
    description: "a DSN password containing @, the default symbol set of every password manager",
    text: "mongodb+srv://admin:P@ss123@cluster0.abc.mongodb.net/test",
    secret: "P@ss123",
  },
  {
    ruleId: "url-credentials",
    description: "a percent-encoded @ in the password",
    text: "https://u:p%40ss@example.com/x",
    secret: "p%40ss",
  },
  {
    ruleId: "url-credentials",
    description: "a password whose own @ is the last one in the run",
    text: "amqp://guest:gu@est@rabbit.internal:5672",
    secret: "gu@est",
  },
  {
    ruleId: "authorization-header",
    description: "RFC 7617's Basic example",
    text: `Authorization: Basic ${RFC7617_BASIC}`,
    secret: RFC7617_BASIC,
  },
  {
    ruleId: "authorization-header",
    description: "a bearer JWT",
    text: `authorization: Bearer ${JWT_IO_CANONICAL}`,
    secret: JWT_IO_CANONICAL,
  },
  {
    ruleId: "authorization-header",
    description: "GitHub's `token` scheme",
    text: `Authorization: token ${GITHUB_DOC_PAT}`,
    secret: GITHUB_DOC_PAT,
  },
  {
    ruleId: "anthropic-key",
    description: "an api03 key",
    text: `export ANTHROPIC_KEY ${ANTHROPIC_API03_KEY}`,
    secret: ANTHROPIC_API03_KEY,
  },
  {
    ruleId: "anthropic-key",
    description: "an admin key",
    text: credentialFixture("sk-ant-", "admin01-EXAMPLEfakeadminkeymaterial0123456789ab"),
    secret: credentialFixture("sk-ant-", "admin01-EXAMPLEfakeadminkeymaterial0123456789ab"),
  },
  {
    ruleId: "anthropic-key",
    description: "a key inside prose",
    text: `the key is ${ANTHROPIC_API03_KEY_PROSE} and it leaked`,
    secret: ANTHROPIC_API03_KEY_PROSE,
  },
  {
    ruleId: "openrouter-key",
    description: "a v1 key",
    text: OPENROUTER_V1_KEY,
    secret: OPENROUTER_V1_KEY,
  },
  {
    ruleId: "openrouter-key",
    description: "a v1 key inside prose",
    text: `use ${OPENROUTER_V1_KEY_PROSE} for staging`,
    secret: OPENROUTER_V1_KEY_PROSE,
  },
  {
    ruleId: "openrouter-key",
    description: "a v1 key in an assignment",
    text: `OPENROUTER_API_KEY=${OPENROUTER_V1_KEY_ASSIGNED}`,
    secret: OPENROUTER_V1_KEY_ASSIGNED,
  },
  {
    ruleId: "openai-key",
    description: "a project key",
    text: "OPENAI_KEY sk-proj-EXAMPLEfakeOpenAIkey1234567890abcdef",
    secret: "sk-proj-EXAMPLEfakeOpenAIkey1234567890abcdef",
  },
  {
    ruleId: "openai-key",
    description: "a legacy key",
    text: "sk-EXAMPLEfakeLegacyKey1234567890abcdefghij",
    secret: "sk-EXAMPLEfakeLegacyKey1234567890abcdefghij",
  },
  {
    ruleId: "openai-key",
    description: "a key inside prose",
    text: "paste sk-EXAMPLEfakeSecondLegacyKey0987654321 into the field",
    secret: "sk-EXAMPLEfakeSecondLegacyKey0987654321",
  },
  {
    ruleId: "aws-access-key-id",
    description: "AWS's published AKIA example",
    text: `aws_access_key_id ${AWS_DOC_ACCESS_KEY_ID}`,
    secret: AWS_DOC_ACCESS_KEY_ID,
  },
  {
    ruleId: "aws-access-key-id",
    description: "a temporary ASIA id",
    text: credentialFixture("ASIA", "Y34FZKBOKMUTVV7A is the session id"),
    secret: credentialFixture("ASIA", "Y34FZKBOKMUTVV7A"),
  },
  {
    ruleId: "aws-access-key-id",
    description: "an ABIA id inside prose",
    text: "rotate ABIAIOSFODNN7EXAMPLE before Friday",
    secret: "ABIAIOSFODNN7EXAMPLE",
  },
  {
    ruleId: "github-token",
    description: "GitHub's documented ghp_ example",
    text: `token ${GITHUB_DOC_PAT}`,
    secret: GITHUB_DOC_PAT,
  },
  {
    ruleId: "github-token",
    description: "an OAuth gho_ token",
    text: GITHUB_OAUTH_TOKEN,
    secret: GITHUB_OAUTH_TOKEN,
  },
  {
    ruleId: "github-token",
    description: "a fine-grained github_pat_ token",
    text: "github_pat_11ABCDEFG0EXAMPLEfakefinegrainedtokenvalue123456",
    secret: "github_pat_11ABCDEFG0EXAMPLEfakefinegrainedtokenvalue123456",
  },
  {
    ruleId: "slack-token",
    description: "a bot token",
    text: SLACK_BOT_TOKEN,
    secret: SLACK_BOT_TOKEN,
  },
  {
    ruleId: "slack-token",
    description: "a user token",
    text: `the token ${SLACK_USER_TOKEN} is stale`,
    secret: SLACK_USER_TOKEN,
  },
  {
    ruleId: "slack-token",
    description: "an app-level token",
    text: credentialFixture("xoxa", "-2-401234567890-fakeAppLevelTokenValue"),
    secret: credentialFixture("xoxa", "-2-401234567890-fakeAppLevelTokenValue"),
  },
  {
    ruleId: "google-api-key",
    description: "a browser key",
    text: GOOGLE_API_KEY_BROWSER,
    secret: GOOGLE_API_KEY_BROWSER,
  },
  {
    ruleId: "google-api-key",
    description: "a key inside prose",
    text: `maps key ${GOOGLE_API_KEY_PROSE} expires soon`,
    secret: GOOGLE_API_KEY_PROSE,
  },
  {
    ruleId: "google-api-key",
    description: "a key in a query string",
    text: `https://maps.example.com/api?key=${GOOGLE_API_KEY_QUERY}`,
    secret: GOOGLE_API_KEY_QUERY,
  },
  {
    ruleId: "gitlab-token",
    description: "a personal access token",
    text: GITLAB_PAT,
    secret: GITLAB_PAT,
  },
  {
    ruleId: "gitlab-token",
    description: "a token inside prose",
    text: `CI uses ${GITLAB_PAT_PROSE} for the runner`,
    secret: GITLAB_PAT_PROSE,
  },
  {
    ruleId: "gitlab-token",
    description: "a token with underscores",
    text: GITLAB_PAT_UNDERSCORES,
    secret: GITLAB_PAT_UNDERSCORES,
  },
  {
    ruleId: "stripe-secret-key",
    description: "Stripe's documented test key",
    text: `STRIPE ${STRIPE_DOC_TEST_KEY}`,
    secret: STRIPE_DOC_TEST_KEY,
  },
  {
    ruleId: "stripe-secret-key",
    description: "a live secret key",
    text: STRIPE_LIVE_SECRET_KEY,
    secret: STRIPE_LIVE_SECRET_KEY,
  },
  {
    ruleId: "stripe-secret-key",
    description: "a restricted key",
    text: `use ${STRIPE_RESTRICTED_KEY} for the webhook`,
    secret: STRIPE_RESTRICTED_KEY,
  },
  {
    ruleId: "npm-token",
    description: "a classic automation token",
    text: NPM_CLASSIC_TOKEN,
    secret: NPM_CLASSIC_TOKEN,
  },
  {
    ruleId: "npm-token",
    description: "a token in an npmrc line",
    text: `//registry.npmjs.org/:_authToken=${NPM_TOKEN_NPMRC}`,
    secret: NPM_TOKEN_NPMRC,
  },
  {
    ruleId: "npm-token",
    description: "a token inside prose",
    text: `the CI token ${NPM_TOKEN_PROSE} expired`,
    secret: NPM_TOKEN_PROSE,
  },
  {
    ruleId: "shopify-token",
    description: "an admin API access token",
    text: SHOPIFY_ADMIN_TOKEN,
    secret: SHOPIFY_ADMIN_TOKEN,
  },
  {
    ruleId: "shopify-token",
    description: "a custom app token",
    text: credentialFixture("header X-Shopify-Access-Token shpca", "_fedcba9876543210fedcba9876543210"),
    secret: credentialFixture("shpca", "_fedcba9876543210fedcba9876543210"),
  },
  {
    ruleId: "shopify-token",
    description: "a private app password",
    text: credentialFixture("shppa", "_00112233445566778899aabbccddeeff"),
    secret: credentialFixture("shppa", "_00112233445566778899aabbccddeeff"),
  },
  {
    ruleId: "digitalocean-token",
    description: "a personal access token",
    text: `dop_v1_${"0123456789abcdef".repeat(4)}`,
    secret: `dop_v1_${"0123456789abcdef".repeat(4)}`,
  },
  {
    ruleId: "digitalocean-token",
    description: "an OAuth token",
    text: `doo_v1_${"fedcba9876543210".repeat(4)} is the oauth token`,
    secret: `doo_v1_${"fedcba9876543210".repeat(4)}`,
  },
  {
    ruleId: "digitalocean-token",
    description: "a refresh token",
    text: `dor_v1_${"00112233445566778899aabbccddeeff".repeat(2)}`,
    secret: `dor_v1_${"00112233445566778899aabbccddeeff".repeat(2)}`,
  },
  {
    ruleId: "jwt",
    description: "jwt.io's canonical HS256 token",
    text: `the reply was ${JWT_IO_CANONICAL} which decodes fine`,
    secret: JWT_IO_CANONICAL,
  },
  {
    ruleId: "jwt",
    description: "an RS256 token",
    text: "eyJhbGciOiJSUzI1NiIsImtpZCI6ImFiYyJ9.eyJpc3MiOiJodHRwczovL2V4YW1wbGUuY29tIn0.QUJDREVGRkFLRVNJR05BVFVSRQ",
    secret:
      "eyJhbGciOiJSUzI1NiIsImtpZCI6ImFiYyJ9.eyJpc3MiOiJodHRwczovL2V4YW1wbGUuY29tIn0.QUJDREVGRkFLRVNJR05BVFVSRQ",
  },
  {
    ruleId: "jwt",
    description: "an unsigned token with two eyJ segments",
    text: "id_token=eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiIxMjM0NTY3ODkwIn0",
    secret: "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiIxMjM0NTY3ODkwIn0",
  },
  {
    ruleId: "credential-assignment",
    description: "AWS's published secret access key in an env assignment",
    text: `AWS_SECRET_ACCESS_KEY=${AWS_DOC_SECRET_ACCESS_KEY}`,
    secret: AWS_DOC_SECRET_ACCESS_KEY,
  },
  {
    ruleId: "credential-assignment",
    description: "a quoted yaml password",
    text: 'db_password: "Tr0ub4dor&3xyz"',
    secret: "Tr0ub4dor&3xyz",
  },
  {
    ruleId: "credential-assignment",
    description: "a hyphenated header name",
    text: "X-Api-Key: 8f14e45fceea167a5a36dedd4bea2543",
    secret: "8f14e45fceea167a5a36dedd4bea2543",
  },
  {
    ruleId: "credential-assignment",
    description: "a camelCase name",
    text: "const apiSecret = 'hunter2hunter2';",
    secret: "hunter2hunter2",
  },
  {
    ruleId: "credential-assignment",
    /**
     * The span takes the trailing `;` with it. `;` is not a terminator, because
     * a password may contain one (`password=Passw0rd;More1234` used to mask
     * `Passw0rd` and send `;More1234` to the provider); a connection string that
     * needs a `;` inside a value quotes it. Over-masking one character of
     * syntax is the safe side of that trade, and the restore puts it back.
     */
    description: "a SQL Server connection string",
    text: "Server=tcp:db.example.com;Database=app;User Id=svc;Password=Wint3rIsC0ming;",
    secret: "Wint3rIsC0ming;",
  },
  {
    ruleId: "credential-assignment",
    description: "a JSON body, where the name is quoted too",
    text: '{"api_key": "s3cr3tV4lu3XYZ"}',
    secret: "s3cr3tV4lu3XYZ",
  },
  {
    ruleId: "credential-assignment",
    description: "a single-quoted mapping entry",
    text: "{'password': 'Hunter2Winter'}",
    secret: "Hunter2Winter",
  },
  {
    ruleId: "credential-assignment",
    description: "a backtick-quoted name",
    text: "`db_password` = `Tr0ub4dorXYZ`",
    secret: "Tr0ub4dorXYZ",
  },
  {
    ruleId: "credential-assignment",
    description: "a key in a query string, after a candidate the accept stage rejects",
    text: "https://api.example.com/v1/items?x=1&api_key=s3cr3tV4lu3XYZ",
    secret: "s3cr3tV4lu3XYZ",
  },
  {
    ruleId: "credential-assignment",
    description: "a password in a url query string that starts with a rejected name",
    text: "url=https://a.example.com/cb?password=Hunter2Winter",
    secret: "Hunter2Winter",
  },
  {
    ruleId: "high-entropy-string",
    description: "AWS's published secret access key on its own",
    text: `leftover ${AWS_DOC_SECRET_ACCESS_KEY} value`,
    secret: AWS_DOC_SECRET_ACCESS_KEY,
    options: { highEntropyRule: true },
  },
  {
    ruleId: "high-entropy-string",
    description: "a 44-character base64 blob",
    text: "blob dGhpcyBpcyBhIHRlc3Qgb2YgZW50cm9weSBjaGVjaw== end",
    secret: "dGhpcyBpcyBhIHRlc3Qgb2YgZW50cm9weSBjaGVjaw==",
    options: { highEntropyRule: true },
  },
  {
    ruleId: "high-entropy-string",
    description: "a 44-character mixed-case random run",
    text: "value Kj8mQz2XvB7nLp0RtYw5Ec3AsDfGhJkLzXcVbNmQwErT stop",
    secret: "Kj8mQz2XvB7nLp0RtYw5Ec3AsDfGhJkLzXcVbNmQwErT",
    options: { highEntropyRule: true },
  },
];

const NEGATIVES: readonly NegativeCase[] = [
  {
    ruleId: "private-key-block",
    description: "a public certificate block",
    text: `-----BEGIN CERTIFICATE-----\n${PEM_BODY}\n-----END CERTIFICATE-----`,
  },
  {
    ruleId: "private-key-block",
    description: "prose about private keys",
    text: "Please BEGIN PRIVATE KEY rotation before the next sprint.",
  },
  {
    ruleId: "url-credentials",
    description: "a plain https url",
    text: "https://example.com/path?a=b",
  },
  {
    ruleId: "url-credentials",
    description: "a url with a username but no password",
    text: "https://git@github.com/org/repo.git",
  },
  {
    ruleId: "url-credentials",
    description: "a host:port url",
    text: "http://localhost:3000/api/health",
  },
  {
    ruleId: "url-credentials",
    description: "a bare email address in prose",
    text: "contact me@example.com about the outage",
  },
  {
    ruleId: "authorization-header",
    description: "an env-var placeholder",
    text: "Authorization: Bearer ${ACCESS_TOKEN}",
  },
  {
    ruleId: "authorization-header",
    description: "prose",
    text: "Authorization required for this endpoint.",
  },
  {
    ruleId: "anthropic-key",
    description: "a too-short key",
    text: ANTHROPIC_API03_TOO_SHORT,
  },
  {
    ruleId: "anthropic-key",
    description: "an OpenRouter key",
    text: OPENROUTER_V1_KEY,
  },
  {
    ruleId: "openrouter-key",
    description: "a v2 prefix that does not exist",
    text: credentialFixture("sk-or-", "v2-0123456789abcdef0123456789abcdef0123456789abcdef"),
  },
  {
    ruleId: "openrouter-key",
    description: "an Anthropic key",
    text: ANTHROPIC_API03_KEY,
  },
  {
    ruleId: "openai-key",
    description: "an Anthropic key",
    text: ANTHROPIC_API03_KEY,
  },
  {
    ruleId: "openai-key",
    description: "an OpenRouter key",
    text: OPENROUTER_V1_KEY,
  },
  {
    ruleId: "openai-key",
    description: "a hyphenated word ending in sk-",
    text: "task-management-and-tracking-system-2024",
  },
  {
    ruleId: "aws-access-key-id",
    description: "prose naming the prefix",
    text: "The AKIA prefix identifies a long-term access key id.",
  },
  {
    ruleId: "aws-access-key-id",
    description: "an id embedded in a longer word run",
    text: AWS_ACCESS_KEY_TOO_LONG,
  },
  {
    ruleId: "github-token",
    description: "a too-short ghp_ value",
    text: GITHUB_PAT_TOO_SHORT,
  },
  {
    ruleId: "github-token",
    description: "an unknown gh prefix",
    text: "ghz_16C7e42F292c6912E7710c838347Ae178B4a",
  },
  {
    ruleId: "slack-token",
    description: "a missing type letter",
    text: credentialFixture("xox", "-2401234567890-2401234567891-fakeSlackTokenValue"),
  },
  {
    ruleId: "slack-token",
    description: "a too-short suffix",
    text: "xoxb-short",
  },
  {
    ruleId: "google-api-key",
    description: "a truncated key",
    text: GOOGLE_API_KEY_TRUNCATED,
  },
  {
    ruleId: "google-api-key",
    description: "an AIza word fragment",
    text: "AIzaShort",
  },
  {
    ruleId: "gitlab-token",
    description: "a too-short token",
    text: "glpat-short",
  },
  {
    ruleId: "gitlab-token",
    description: "a token glued to a preceding word",
    text: `my${GITLAB_PAT}`,
  },
  {
    ruleId: "stripe-secret-key",
    description: "Stripe's publishable live key, which is designed to ship in client JS",
    text: STRIPE_DOC_PUBLISHABLE_KEY,
  },
  {
    ruleId: "stripe-secret-key",
    description: "a publishable test key",
    text: "pk_test_TYooMQauvdEDq54NiTphI7jx",
  },
  {
    ruleId: "npm-token",
    description: "a too-short npm_ value",
    text: NPM_TOKEN_TOO_SHORT,
  },
  {
    ruleId: "npm-token",
    description: "an npm command",
    text: `${NPM_CONFIG_REGISTRY_LOOKALIKE} is not a token`,
  },
  {
    ruleId: "shopify-token",
    description: "a too-short token",
    text: SHOPIFY_TOKEN_TOO_SHORT,
  },
  {
    ruleId: "shopify-token",
    description: "an unknown shp prefix",
    text: credentialFixture("shp", "xx_0123456789abcdef0123456789abcdef"),
  },
  {
    ruleId: "digitalocean-token",
    description: "a too-short token",
    text: DIGITALOCEAN_TOKEN_TOO_SHORT,
  },
  {
    ruleId: "digitalocean-token",
    description: "a v2 prefix that does not exist",
    text: `dop_v2_${"0123456789abcdef".repeat(4)}`,
  },
  {
    ruleId: "jwt",
    description: "a semver string",
    text: "v1.2.3-beta.4",
  },
  {
    ruleId: "jwt",
    description: "a file path",
    text: "src/main/keybindings/correction.ts",
  },
  {
    ruleId: "jwt",
    description: "only one eyJ segment",
    text: "eyJhbGciOiJIUzI1NiJ9.plaintextpayload.signaturevalue",
  },
  {
    ruleId: "credential-assignment",
    description: "monkey business",
    text: "monkey=business",
  },
  {
    ruleId: "credential-assignment",
    description: "a tokenizer construction",
    text: "tokenizer = new Tokenizer()",
  },
  // The scan resumes INSIDE a rejected candidate, so `monkey` is retried three
  // characters in and offers `key`. These carry values long enough that the
  // minimum length cannot rescue them — only the name boundary can.
  {
    ruleId: "credential-assignment",
    description: "the `key` hiding in `monkey`",
    text: "monkey=businessvalue",
  },
  {
    ruleId: "credential-assignment",
    description: "the `key` hiding in `donkey`",
    text: "donkey: brownbread",
  },
  {
    ruleId: "credential-assignment",
    description: "the `key` hiding in `turkey`",
    text: "turkey = gobblegobble",
  },
  {
    ruleId: "credential-assignment",
    description: "an angle-bracket placeholder",
    text: "API_KEY=<your-key-here>",
  },
  {
    ruleId: "credential-assignment",
    description: "a shell variable reference",
    text: "password=${DB_PASS}",
  },
  {
    ruleId: "high-entropy-string",
    description: "a 40-hex git SHA",
    text: "da39a3ee5e6b4b0d3255bfef95601890afd80709",
    options: { highEntropyRule: true },
  },
  {
    ruleId: "high-entropy-string",
    description: "a UUID",
    text: "550e8400-e29b-41d4-a716-446655440000",
    options: { highEntropyRule: true },
  },
  {
    ruleId: "high-entropy-string",
    description: "a high-entropy run while the rule is off",
    text: "Kj8mQz2XvB7nLp0RtYw5Ec3AsDfGhJkLzXcVbNmQwErT",
  },
];

/**
 * The pinned must-not-match set from the plan. These must produce ZERO matches
 * from ANY rule, with the opt-in rule both off and on.
 */
const MUST_NOT_MATCH: readonly string[] = [
  "monkey=business",
  "MONKEY=1",
  "donkey: brown",
  "tokenizer = new Tokenizer()",
  "API_KEY=<your-key-here>",
  "password=${DB_PASS}",
];

/**
 * A reported span is the credential itself, or the credential plus the matched
 * pair of quote characters an assignment wrapped it in — `credential-assignment`
 * widens over those unconditionally, because the credential may BE its own
 * quotes and nothing local says which (see `spanWidening`).
 *
 * Nothing else passes: a span that adds anything other than one matched pair of
 * identical quotes is over-reach, and a span that covers LESS than the
 * credential is the partial mask this whole file exists to prevent.
 */
const spanReportsSecret = (span: string, secret: string): boolean =>
  span === secret ||
  (/^(["'`])[\s\S]*\1$/.test(span) && span.slice(1, -1) === secret);

describe("scanForSecrets", () => {
  describe("positives", () => {
    it.each(POSITIVES)("$ruleId — $description", ({ ruleId, text, secret, options }) => {
      const result = scanForSecrets(text, options);
      expect(result.ruleIds).toContain(ruleId);
      const spans = result.matches.map((match) => text.slice(match.start, match.end));
      expect(spans.some((span) => spanReportsSecret(span, secret))).toBe(true);
    });
  });

  describe("negatives", () => {
    it.each(NEGATIVES)("$ruleId — $description", ({ ruleId, text, options }) => {
      const result = scanForSecrets(text, options);
      expect(result.ruleIds).not.toContain(ruleId);
    });
  });

  describe("every rule carries its own evidence", () => {
    it.each(SECRET_RULES.map((rule) => rule.id))("%s has 3+ positives and 2+ negatives", (id) => {
      expect(POSITIVES.filter((entry) => entry.ruleId === id).length).toBeGreaterThanOrEqual(3);
      expect(NEGATIVES.filter((entry) => entry.ruleId === id).length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("the pinned must-not-match strings", () => {
    it.each(MUST_NOT_MATCH)("%s yields nothing with the opt-in rule off", (text) => {
      expect(scanForSecrets(text)).toEqual({ matches: [], ruleIds: [] });
    });

    it.each(MUST_NOT_MATCH)("%s yields nothing with the opt-in rule on", (text) => {
      expect(scanForSecrets(text, { highEntropyRule: true })).toEqual({ matches: [], ruleIds: [] });
    });
  });

  // The normal case when a user selects half a file. Without the second
  // alternative the most dangerous input in the feature is the one that
  // silently does not match.
  it("matches an unterminated private key block to the end of the text", () => {
    const text = `-----BEGIN RSA PRIVATE KEY-----\n${PEM_BODY}`;
    const result = scanForSecrets(text);
    expect(result.ruleIds).toContain("private-key-block");
    expect(result.matches).toHaveLength(1);
    expect(text.slice(result.matches[0].start, result.matches[0].end)).toBe(text);
  });

  it("matches an unterminated PGP private key block to the end of the text", () => {
    const text = `-----BEGIN PGP PRIVATE KEY BLOCK-----\n\n${PGP_BODY}`;
    const result = scanForSecrets(text);
    expect(result.ruleIds).toContain("private-key-block");
    expect(text.slice(result.matches[0].start, result.matches[0].end)).toBe(text);
  });

  it("prefers the terminated block when one is present", () => {
    const text = `${pemBlock("RSA")}\ntrailing prose that must survive`;
    const result = scanForSecrets(text);
    expect(text.slice(result.matches[0].start, result.matches[0].end)).toBe(pemBlock("RSA"));
  });

  it("names a rule whose span was absorbed into a higher-priority span", () => {
    const text = `-----BEGIN RSA PRIVATE KEY-----\n${SLACK_BOT_TOKEN}\n-----END RSA PRIVATE KEY-----`;
    const result = scanForSecrets(text);
    expect(result.matches).toHaveLength(1);
    expect(result.ruleIds).toContain("private-key-block");
    expect(result.ruleIds).toContain("slack-token");
  });

  /**
   * A pattern-level length cap is a truncation the merge cannot undo: the span
   * stops mid-credential, the masker replaces only that much, and the tail sits
   * in the outgoing text immediately after the placeholder. A value longer than
   * any bound must be matched IN FULL or not at all — never partially.
   */
  describe("long values are never half-matched", () => {
    const LONG_VALUE = "a1B2".repeat(70);

    it("spans a 280-character assignment value in full", () => {
      const text = `SESSION_TOKEN=${LONG_VALUE} trailing text`;
      const result = scanForSecrets(text);
      expect(result.ruleIds).toContain("credential-assignment");
      expect(result.matches).toHaveLength(1);
      expect(text.slice(result.matches[0].start, result.matches[0].end)).toBe(LONG_VALUE);
    });

    /**
     * A cap counted in UTF-16 code units against a Unicode-inclusive class can
     * fall between the halves of a surrogate pair, leaving invalid UTF-16 in the
     * masked text AND in the value kept for the restore.
     */
    it("never cuts an astral-plane character in half", () => {
      const value = `${"a1B2c3D4".repeat(24)}abcdefg\u{1F600}trailingSecretBits1234`;
      const text = `SESSION_TOKEN=${value} end`;
      const result = scanForSecrets(text);
      const matched = text.slice(result.matches[0].start, result.matches[0].end);
      expect(matched).toBe(value);
      expect(matched).not.toMatch(
        /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/,
      );
    });
  });

  /**
   * This runs synchronously on the Electron main process on the hotkey path, and
   * the size cap above it is a confirm the user can wave through (or switch off
   * entirely), so nothing else bounds the input.
   */
  it("scans 100 000 characters of dot-separated text without freezing the main process", () => {
    const text = "host-a.example.com.".repeat(5264);
    const startedAt = performance.now();
    scanForSecrets(text);
    expect(performance.now() - startedAt).toBeLessThan(300);
  });

  /**
   * `credential-assignment` is the rule the whole default-on guard rests on and
   * the one with an UNBOUNDED value, so it is the one that goes quadratic when a
   * rejected candidate is retried a character later: every candidate start would
   * re-scan the rest of the text before its name is rejected.
   *
   * These shapes are ordinary — a pasted URL, a form body, a `.env` dump on one
   * line — and none of them contains a credential, so the correct answer is
   * "nothing" and the only thing under test is how long it takes to say so. The
   * bound is generous against the measured cost (single-digit ms under bun for
   * every case) precisely so it only ever fires on a return to quadratic, which
   * costs SECONDS, and never on a slow CI box.
   */
  /**
   * The name gate inside the pattern is the only part of the rule that can turn
   * an ACCEPT into a miss, and it would do it silently — a name simply stops
   * matching, with nothing to see. So the gate is not restated here; it is
   * DERIVED from `isCredentialName`, over names generated from the credential
   * words and the non-credential words that have caught the rule out before.
   *
   * The direction that matters is `isCredentialName ⟹ the rule matches`: the
   * gate may be looser than `isCredentialName` (the accept stage still says no)
   * but never tighter. The perf block below is what holds the other direction,
   * since a gate that lets `monkey` through is a gate that goes quadratic.
   */
  describe("the name gate agrees with isCredentialName", () => {
    const FRAGMENTS: readonly string[] = [
      ...CREDENTIAL_NAME_SEGMENTS,
      ...[...CREDENTIAL_NAME_SEGMENTS].map((word) => word.toUpperCase()),
      ...[...CREDENTIAL_NAME_SEGMENTS].map((word) => `${word[0].toUpperCase()}${word.slice(1)}`),
      "monkey",
      "donkey",
      "turkey",
      "apikey",
      "keyboard",
      "keyword",
      "tokenizer",
      "secrets",
      "tokens",
      "credentials",
      "passwords",
      "MONKEY",
      "APIKEY",
      "Keyboard",
      "api",
      "aws",
      "db",
      "x",
      "v2",
      "my",
      "app",
      "AWS",
      "X",
      "Id",
      "S3",
    ];
    const JOINERS: readonly string[] = ["", "_", "-", ".", "1", "2"];

    const NAMES: readonly string[] = [
      ...new Set(
        FRAGMENTS.flatMap((left) =>
          JOINERS.flatMap((joiner) =>
            FRAGMENTS.flatMap((right) => [
              `${left}${joiner}${right}`,
              `${left[0].toUpperCase()}${left.slice(1)}${joiner}${right}`,
              `${left}${joiner}${right[0].toUpperCase()}${right.slice(1)}`,
            ]),
          ),
        ),
      ),
    ].filter((name) => /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(name));

    it("generates a corpus large enough to be evidence", () => {
      expect(NAMES.length).toBeGreaterThan(5_000);
      expect(NAMES.filter((name) => isCredentialName(name)).length).toBeGreaterThan(1_000);
    });

    /**
     * Driven through the RULE'S OWN PATTERN rather than through
     * `scanForSecrets`, and that is the whole point of the test. `accept` calls
     * `isCredentialName` on the same name, so a scan can never report a name
     * the function rejects however wrong the gate is — asserting on the scan
     * would prove the gate correct by construction. The raw pattern is the only
     * place the gate answers on its own.
     */
    const patternAccepts = (name: string): boolean => {
      const rule = SECRET_RULES.find((candidate) => candidate.id === "credential-assignment");
      if (rule === undefined) throw new Error("credential-assignment rule is missing");
      return new RegExp(rule.pattern.source, rule.pattern.flags).test(`${name}=Hunter2Winter`);
    };

    it("lets through exactly the names isCredentialName accepts", () => {
      const missed: string[] = [];
      const invented: string[] = [];
      for (const name of NAMES) {
        if (isCredentialName(name) && !patternAccepts(name)) missed.push(name);
        if (!isCredentialName(name) && patternAccepts(name)) invented.push(name);
      }
      expect({ missed: missed.slice(0, 10), invented: invented.slice(0, 10) }).toEqual({
        missed: [],
        invented: [],
      });
    });

    it("reports every one of those names end to end", () => {
      const missed = NAMES.filter(
        (name) =>
          isCredentialName(name) &&
          !scanForSecrets(`${name}=Hunter2Winter`).ruleIds.includes("credential-assignment"),
      );
      expect(missed.slice(0, 10)).toEqual([]);
    });

    it.each([...CREDENTIAL_NAME_SEGMENTS])(
      "still matches an assignment whose name is the credential word %s",
      (segment) => {
        for (const name of [segment, segment.toUpperCase(), `app_${segment}_1`]) {
          const text = `${name}=Hunter2Winter`;
          const result = scanForSecrets(text);
          expect(result.matches.map((match) => text.slice(match.start, match.end))).toEqual([
            "Hunter2Winter",
          ]);
        }
      },
    );
  });

  describe("credential-assignment stays linear on whitespace-free text", () => {
    const BUDGET_MS = 300;

    const scanMs = (text: string): number => {
      const startedAt = performance.now();
      const result = scanForSecrets(text);
      const elapsed = performance.now() - startedAt;
      expect(result.matches).toEqual([]);
      return elapsed;
    };

    it("scans a 542 000-character form-encoded body with no credential in it", () => {
      const text = Array.from({ length: 26_000 }, (_unused, index) =>
        `field${index}=value${index}abcd`,
      ).join("&");
      expect(text.length).toBeGreaterThan(500_000);
      expect(scanMs(text)).toBeLessThan(BUDGET_MS);
    });

    it("scans a 542 000-character run of two-character assignments", () => {
      expect(scanMs("k=".repeat(271_000))).toBeLessThan(BUDGET_MS);
    });

    it("scans a 32 000-parameter url with zero credentials in it", () => {
      const query = Array.from({ length: 32_000 }, (_unused, index) =>
        `param${index}=value${index}`,
      ).join("&");
      expect(scanMs(`https://example.com/search?${query}`)).toBeLessThan(BUDGET_MS);
    });

    /**
     * The three cases above use names (`field0`, `k`, `param0`) that carry no
     * credential word at all, so they only ever exercised the cheapest rejection
     * the rule has. A perf test that cannot fail is worse than none: the shapes
     * that actually went quadratic are the ones whose name LOOKS like a
     * credential to a substring test and is not one to `isCredentialName` —
     * `apikey`, `monkey`, `secrets`, `tokens`, `credentials`. Each of these was
     * 12–37 SECONDS of frozen main process.
     *
     * They also need a document with no whitespace and no quote, comma or
     * semicolon in it — a pipe-joined dump — because the value has to be free to
     * run to the end of the text before the name is rejected.
     */
    it.each(["apikey", "monkey", "secrets", "tokens", "credentials", "keyword"])(
      "scans a 500 000-character pipe-joined run of `%s=` without going quadratic",
      (name) => {
        const text = Array.from(
          { length: 26_000 },
          (_unused, index) => `${name}=value${index}abcd`,
        ).join("|");
        expect(text.length).toBeGreaterThan(400_000);
        expect(scanMs(text)).toBeLessThan(BUDGET_MS);
      },
    );

    /**
     * The other half of the resume loop, and the pathological end of it: 42 000
     * names the gate CANNOT turn away, each with a value the accept stage then
     * rejects. Nothing bounds these but the value's own maximum, so the cost is
     * candidates × `MAX_CREDENTIAL_VALUE_LENGTH` — measured at 182 ms under V8,
     * against 76 SECONDS before this round. The budget is wider than its
     * siblings' because the measurement is, and it is still decisive: a return
     * to quadratic on this shape is two orders of magnitude away from it.
     */
    it("scans a 800 000-character run of accepted names with rejected values", () => {
      const text = Array.from(
        { length: 42_000 },
        (_unused, index) => `api_key=\${VAR${index}}`,
      ).join("|");
      expect(text.length).toBeGreaterThan(400_000);
      expect(scanMs(text)).toBeLessThan(600);
    });

    /**
     * The shape with no operator in it at all, which every case above misses:
     * the name gate runs at each of 80 000 candidate starts and finds no `=`,
     * so what is measured is the gate itself rather than the value scan. It is
     * also the shape where the engine matters most — the same input is ~20 ms
     * under V8 (what Electron ships) and ~260 ms under JavaScriptCore (what
     * runs this test), so the budget is set for the slower of the two.
     */
    it("scans 720 000 characters of credential-shaped words with no assignment in them", () => {
      expect(scanMs("PaSswOrd-".repeat(80_000))).toBeLessThan(600);
    });
  });

  /**
   * The value maximum exists so one rejected candidate cannot cost a scan of
   * the rest of the document. It must never become a truncation: a span that
   * stops mid-credential is replaced by a placeholder with the rest of the
   * credential sitting immediately after it, reported to the user as a
   * successful mask. Over the maximum, the candidate is rejected outright.
   */
  describe("the value maximum rejects rather than truncates", () => {
    const longValue = (length: number): string =>
      "a1B2c3D4".repeat(Math.ceil(length / 8)).slice(0, length);

    it("matches a value one character under the maximum in full", () => {
      const value = longValue(MAX_CREDENTIAL_VALUE_LENGTH - 1);
      const text = `SESSION_TOKEN=${value} end`;
      const result = scanForSecrets(text);
      expect(result.matches.map((match) => text.slice(match.start, match.end))).toEqual([value]);
    });

    it("matches a value exactly at the maximum in full", () => {
      const value = longValue(MAX_CREDENTIAL_VALUE_LENGTH);
      const text = `SESSION_TOKEN=${value} end`;
      const result = scanForSecrets(text);
      expect(result.matches.map((match) => text.slice(match.start, match.end))).toEqual([value]);
    });

    it("yields nothing at all for a value one character over the maximum", () => {
      const value = longValue(MAX_CREDENTIAL_VALUE_LENGTH + 1);
      const text = `SESSION_TOKEN=${value} end`;
      expect(scanForSecrets(text).ruleIds).not.toContain("credential-assignment");
    });

    /**
     * The maximum counts CODE POINTS, not UTF-16 units, so it can never fall
     * between the halves of a surrogate pair and leave invalid UTF-16 in the
     * outgoing text and in the value kept for the restore. The values are
     * varied on purpose: a run of one repeated character is rejected by
     * `isPlaceholderValue` long before the maximum is reached, so a uniform
     * string would prove nothing about this boundary.
     */
    describe("the maximum counts code points", () => {
      const astralValue = (codePoints: number): string => {
        let value = "";
        for (let index = 0; index < codePoints; index += 1) {
          value +=
            index % 4 === 0
              ? String.fromCodePoint(0x1f600 + (index % 40))
              : "aB1_-x/+=".charAt(index % 9);
        }
        return value;
      };
      const LONE_SURROGATE =
        /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

      it("matches an astral value of exactly the maximum in full", () => {
        const value = astralValue(MAX_CREDENTIAL_VALUE_LENGTH);
        expect(value.length).toBeGreaterThan(MAX_CREDENTIAL_VALUE_LENGTH);
        const text = `SESSION_TOKEN=${value} end`;
        const matched = scanForSecrets(text).matches.map((match) =>
          text.slice(match.start, match.end),
        );
        expect(matched).toEqual([value]);
        expect(matched[0]).not.toMatch(LONE_SURROGATE);
      });

      it("yields nothing for an astral value one code point over the maximum", () => {
        const text = `SESSION_TOKEN=${astralValue(MAX_CREDENTIAL_VALUE_LENGTH + 1)} end`;
        expect(scanForSecrets(text).ruleIds).not.toContain("credential-assignment");
      });
    });
  });

  /**
   * A single unbroken value — a fingerprint, a base64 field, a pasted encoded
   * file — used to make V8 compile the value matcher recursively and throw
   * `RangeError: Maximum call stack size exceeded` from inside `RegExp.exec`,
   * which reaches `maskSecrets` with no `try`/`catch` anywhere above it.
   *
   * An input the detector cannot scan must never be reported as "no secrets
   * found", so the requirement is that it SCANS, not that it throws politely.
   */
  it("scans a five-million-character unbroken value without exhausting the stack", () => {
    const text = `password=${"a1B2c3D4".repeat(625_000)}`;
    expect(text.length).toBeGreaterThan(5_000_000);
    expect(() => scanForSecrets(text)).not.toThrow();
  });

  /**
   * `url-credentials` used to stop the password at the FIRST `@`, so every DSN
   * whose password carries an `@` — the default symbol set of 1Password,
   * Bitwarden and KeePass — was masked in part and the tail was sent under a
   * "1 credential handled" label. RFC 3986 puts the userinfo/host split at the
   * LAST `@` before the first `/?#`, which is what the rule reads now.
   */
  describe("url-credentials spans the whole password", () => {
    const WHOLE_PASSWORD: readonly (readonly [string, string])[] = [
      ["mongodb+srv://admin:P@ss123@cluster0.abc.mongodb.net/test", "P@ss123"],
      ["postgres://user:p@ssw0rd@host/db", "p@ssw0rd"],
      ["redis://default:aB3@dEf@cache.example.com:6379/0", "aB3@dEf"],
      ["postgres://user:s3cr3tpw@host/db", "s3cr3tpw"],
      ["https://u:p%40ss@example.com/x", "p%40ss"],
      ["amqp://guest:gu@est@rabbit.internal:5672", "gu@est"],
      ["postgres://user:tra@il@host", "tra@il"],
    ];

    it.each(WHOLE_PASSWORD)("%s", (text, password) => {
      const matches = scanForSecrets(text).matches;
      expect(matches).toHaveLength(1);
      expect(text.slice(matches[0].start, matches[0].end)).toBe(password);
    });

    it("leaves a following email address alone", () => {
      const text = "see postgres://user:pw123@host/db and mail me@example.com";
      const matches = scanForSecrets(text).matches;
      expect(matches).toHaveLength(1);
      expect(text.slice(matches[0].start, matches[0].end)).toBe("pw123");
    });

    /**
     * `A@B<delim>C@D` is the SAME shape whether the second `@` is in a query
     * string or the first one is inside a password containing a `#`. RFC 3986
     * resolves both to the first — correctly for the query string and wrongly
     * for the password, where it masks the head and sends the tail. So a run
     * whose last `@` lies past the authority is refused outright: the rare DSN
     * with an `@` in its query is a miss, and no password is ever cut.
     */
    it.each([
      "postgres://user:pass@host/db?x=a@b",
      "postgres://user:pass@host?callback=a@b",
      "postgres://user:KGTk02H@F$Q#f@host:5432/db",
    ])("%s is refused rather than cut at an ambiguous @", (text) => {
      expect(scanForSecrets(text).ruleIds).not.toContain("url-credentials");
    });
  });

  /**
   * A quote that STOPS an unquoted value is not automatically the quote that
   * CLOSED it. `password={5GzCbw2NNxMw<`;F>q7{` was cut at the backtick because
   * the character after it was punctuation, and seven characters of a live
   * password were sent. The value only sits inside a quote when an ODD number of
   * that quote stands between the start of the line and the start of the value.
   */
  describe("an unquoted value stopped by a quote it did not open", () => {
    it.each([
      "password={5GzCbw2NNxMw<`;F>q7{",
      "password=D=C2KR80`\\gfD-OI2:",
      "db_password=Tr0ub4dor'Xyz=99",
      'api_key=s3cr3t"V4lu3=1',
    ])("%s yields nothing rather than a cut span", (text) => {
      expect(scanForSecrets(text).ruleIds).not.toContain("credential-assignment");
    });

    it.each([
      ['{"url": "https://x.example.io/a?password=abc123"}', "abc123"],
      ["{'url': 'https://x.example.io/a?password=abc123'}", "abc123"],
      ['{"callback":"https://x.example.io/cb?api_key=s3cr3tV4lu3XYZ"}', "s3cr3tV4lu3XYZ"],
      ["`https://x.example.io/a?password=abc123`", "abc123"],
      ['<a href="https://x.example.io?password=abc123">', "abc123"],
    ])("%s still masks the credential inside it", (text, secret) => {
      const matches = scanForSecrets(text).matches;
      expect(matches.map((match) => text.slice(match.start, match.end))).toContain(secret);
    });
  });

  /**
   * A single example proves a single example. Every partial-mask defect this
   * rule has had was found by generating passwords over the alphabets password
   * managers actually emit and counting how many spans covered part of the
   * value, so that census is what pins them shut.
   *
   * WHAT IS COUNTED CHANGED IN ROUND 6, AND IT IS NOW THE STRONGER CLAIM.
   * The old predicate was "a span that overlaps the password is exactly the
   * password". It was never true and it passed only on its pinned seed: at
   * n=100 000 on the KeePass alphabet it counts 60 for `password=<p>`, and it
   * counted the same 60 BEFORE this round, so raising n under it would have
   * failed on behaviour nothing had changed. Exactness is also no longer even
   * the goal — a quoted span is now deliberately a superset, which that
   * predicate counts 63 642 times per 100 000. Two things were conflated:
   *
   * - a span that overlaps a password without covering it AND reports
   *   `maskable: true` is a SILENT PARTIAL LEAK — the placeholder goes out with
   *   the rest of the credential beside it and the user is told it was handled.
   *   That is the defect, and it must be zero;
   * - the same span reporting `maskable: false` is a CONFIRM. Nothing is masked,
   *   nothing is sent without consent. `password=Correct Horse Battery` has been
   *   in exactly that state since round 4 by explicit decision, and the 60 above
   *   are the same shape: passwords that begin with, or contain, the quote
   *   character the assignment appears to use.
   *
   * So the census asserts the first and lets the second stand. It is sized to be
   * load-bearing rather than lucky — {@link CENSUS_SEEDS} seeds of
   * {@link CENSUS_SIZE} passwords, 60 000 per shape per alphabet, against 5 000
   * on one seed before — and that size was chosen by MEASURING it against the
   * code this round replaced rather than by picking a round number. Run the same
   * predicate over the round-5 rules and five of these eighteen cells report
   * non-zero: 2 for `password=<p>`, 218 and 236 for the two quoted shapes, 2 070
   * and 2 177 for the markdown and JSON wrappers. The bare unquoted cell is the
   * weak one and always was (~5e-5); it is the quoted and wrapper shapes that
   * make the defect class impossible to miss.
   *
   * The cost is about 5.4 s of the suite's 7.6 s, for 1.08 million scans. That
   * is the whole reason the shapes are separate cells: a failure names which
   * reading broke.
   */
  describe("no generated password is ever masked in part", () => {
    const ALPHANUMERIC = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    /** 1Password and Bitwarden emit exactly this symbol set by default. */
    const PASSWORD_MANAGER_DEFAULT = `${ALPHANUMERIC}!@#$%^&*`;
    /** KeePass's "special characters" box is the whole printable ASCII punctuation set. */
    const KEEPASS_FULL_ASCII = `${ALPHANUMERIC}!"#$%&'()*+,-./:;<=>?@[\\]^_\`{|}~`;

    /** Seeded LCG: a census that flakes proves nothing twice. */
    const createRandom = (seed: number): (() => number) => {
      let state = seed >>> 0;
      return () => {
        state = (state * 1_664_525 + 1_013_904_223) >>> 0;
        return state / 0x1_0000_0000;
      };
    };

    const generatePasswords = (alphabet: string, count: number, seed: number): string[] => {
      const random = createRandom(seed);
      return Array.from({ length: count }, () => {
        const length = 10 + Math.floor(random() * 11);
        return Array.from(
          { length },
          () => alphabet[Math.floor(random() * alphabet.length)],
        ).join("");
      });
    };

    /**
     * A password reported as fully maskable by a span that does not cover it.
     *
     * Covering means `start <= password start` and `end >= password end`: a
     * SUPERSET passes, because masking more of the surrounding text is never a
     * leak and `restoreSecrets` puts the span back byte-exactly. Anything less is
     * a cut, and a cut claiming `maskable: true` is the defect.
     */
    const countPartialMasks = (
      passwords: readonly string[],
      buildText: (password: string) => string,
    ): number =>
      passwords.reduce((partials, password) => {
        const text = buildText(password);
        const start = text.indexOf(password);
        const end = start + password.length;
        const leaked = scanForSecrets(text).matches.some(
          (match) =>
            match.maskable &&
            match.start < end &&
            match.end > start &&
            (match.start > start || match.end < end),
        );
        return partials + (leaked ? 1 : 0);
      }, 0);

    const CENSUS_SIZE = 12_000;
    const CENSUS_SEEDS = [0x5eed_1234, 0x5eed_4321, 0x7a69, 0x0bad_c0de, 0x1337_beef];

    const ALPHABETS: readonly [string, string][] = [
      ["alphanumeric", ALPHANUMERIC],
      ["1Password/Bitwarden default", PASSWORD_MANAGER_DEFAULT],
      ["KeePass full ASCII", KEEPASS_FULL_ASCII],
    ];

    /**
     * Every shape the credential can arrive in. The four after the first two are
     * what round 6 changed: a quoted value now always carries its boundary
     * quotes into the span, and a wrapper's own quote is no longer allowed to
     * corroborate the password's.
     */
    const SHAPES: readonly [string, (password: string) => string][] = [
      ["a DSN", (password) => `postgres://user:${password}@host:5432/db`],
      ["an assignment", (password) => `password=${password}`],
      ["a single-quoted assignment", (password) => `password='${password}'`],
      ["a double-quoted assignment", (password) => `password="${password}"`],
      ["a markdown code span", (password) => `\`password=${password}\``],
      ["a JSON string wrapper", (password) => `{"note": "password=${password}"}`],
    ];

    const CENSUS = SHAPES.flatMap(([shape, buildText]) =>
      ALPHABETS.map(
        ([alphabet, characters]) =>
          [shape, alphabet, characters, buildText] as [
            string,
            string,
            string,
            (password: string) => string,
          ],
      ),
    );

    it.each(CENSUS)("%s of %s passwords", (_shape, _alphabet, characters, buildText) => {
      const partials = CENSUS_SEEDS.reduce(
        (total, seed) =>
          total + countPartialMasks(generatePasswords(characters, CENSUS_SIZE, seed), buildText),
        0,
      );
      expect(partials).toBe(0);
    });

    /**
     * The one shape the census found that no rate makes reliable: a password
     * containing `://` lets `url-credentials` read a second URL out of the first
     * one's userinfo, and the value class (which excludes `/`) then reports the
     * tail as a whole password. One per 100 000 KeePass passwords — too rare for
     * a census to guard, so it is pinned verbatim.
     */
    it("does not read a second URL out of a password containing a scheme separator", () => {
      const text = "postgres://user://+PUIr~G:15]3@host:5432/db";
      const result = scanForSecrets(text);
      expect(result.ruleIds).toContain("url-credentials");
      expect(isFullyMaskable(result)).toBe(false);
    });
  });

  /**
   * `maskable` is justified by COVERAGE under every locally-possible reading,
   * never by a guess about which reading is right. The span is widened over any
   * boundary quotes unconditionally, and `maskable` then holds exactly when the
   * character after the widened span is one a generated credential provably
   * cannot contain: a line break, or end of text.
   *
   * Every earlier round instead corroborated the boundary from a nearby
   * character — a comma, a bracket, a colon, a quote — and every one of those is
   * in the KeePass alphabet, so the password could forge its own corroboration.
   * Four of the false cases are that defect pinned verbatim as it was measured:
   * `'qgRSE9ST):l'>$M` left five characters beside a fully-maskable placeholder,
   * the markdown and JSON wrappers thirteen and five, and each was reported
   * `maskable: true` right up to this round.
   *
   * The false cases are not failures: the match is still reported, the gate
   * downgrades to a confirm, and no recall is lost. Two of them (`# rotate`,
   * `'hunter2hunter2';`) are common code shapes and are an accepted cost, taken
   * deliberately — the credential really could be `hunter2Abc" # rotate` and
   * nothing local says otherwise, and over-confirming is one click where a false
   * `maskable: true` is a silent partial leak.
   */
  describe("a match reports whether masking it would cover the whole credential", () => {
    const firstMatch = (text: string): SecretMatch => {
      const matches = scanForSecrets(text).matches;
      expect(matches.length).toBeGreaterThan(0);
      return matches[0];
    };

    it.each([
      "password=Correct Horse Battery",
      "PASSWORD=hunter2X # rotate quarterly",
      "export API_KEY=s3cr3tV4lu3XYZ && npm start",
      "docker run -e DB_PASSWORD=s3cr3tV4lu3XYZ -p 80:80 app",
      "The api_key=s3cr3tV4lu3XYZ was leaked yesterday.",
      "password='qgRSE9ST):l'>$M",
      '{"callback": "https://a.example.com/cb?password=Hunter2Winter"}',
      "`password=6L{?0e`|})Ry=H(/W.d`",
      '{"note": "password=Ry8H(/W.d"-Tq3"}',
      'PASSWORD="hunter2Abc" # rotate',
      "const apiSecret = 'hunter2hunter2';",
    ])("%s is reported but not maskable", (text) => {
      expect(firstMatch(text).maskable).toBe(false);
      expect(isFullyMaskable(scanForSecrets(text))).toBe(false);
    });

    it.each([
      "password=s3cr3tV4lu3XYZ",
      "password=s3cr3tV4lu3XYZ\nnext line",
      'db_password: "CorrectHorseBattery"',
      'DB_PASSWORD="hunter2Abc"\nDB_HOST=localhost',
      'export API_KEY="s3cr3tV4lu3XYZ"',
      "password='{)Qj,5]s'",
      "postgres://admin:s3cr3tP4ss@db.internal:5432/app today",
      `Authorization: Basic ${RFC7617_BASIC}`,
      `id ${AWS_DOC_ACCESS_KEY_ID} rotates monday`,
    ])("%s is fully maskable", (text) => {
      expect(firstMatch(text).maskable).toBe(true);
      expect(isFullyMaskable(scanForSecrets(text))).toBe(true);
    });

    /**
     * The round-5 defect, now strictly better than the confirm it was downgraded
     * to: the real password IS `'{)Qj,5]s'`, quotes included, and the widened
     * span covers it exactly.
     */
    it("covers a credential that is itself wrapped in the assignment's quote character", () => {
      const text = "password='{)Qj,5]s'";
      const match = firstMatch(text);
      expect(text.slice(match.start, match.end)).toBe("'{)Qj,5]s'");
      expect(match.maskable).toBe(true);
    });

    /**
     * A boolean, never the unmasked remainder. The no-matched-text guarantee is
     * structural, and a field added to explain a partial mask is exactly where
     * someone would be tempted to break it.
     */
    it("says so with a boolean, never with the text it could not cover", () => {
      const text = "password=Correct Horse Battery";
      const match = firstMatch(text);
      expect(typeof match.maskable).toBe("boolean");
      expect(Object.keys(match).sort()).toEqual(["end", "length", "maskable", "ruleId", "start"]);
    });

    it("reports an empty scan as fully maskable", () => {
      expect(isFullyMaskable(scanForSecrets("nothing to see here"))).toBe(true);
    });
  });

  /**
   * `mergeOverlaps` ANDs `maskable` across every span it folds together — a
   * merged span inherits the doubt of everything it swallowed, dropped spans
   * included. Nothing above this point constructs two OVERLAPPING matches
   * whose `maskable` values actually DIFFER, so replacing that AND with an OR
   * left every test above green: a merged span would then inherit
   * `maskable: true` from whichever overlapping span happened to report it,
   * which is exactly the silent partial leak this file exists to rule out —
   * reintroduced at the merge instead of at the rule.
   *
   * `${AWS_DOC_ACCESS_KEY_ID}` (fixed shape, `maskable: true`) as the value of
   * an unquoted `credential-assignment` with trailing text after it
   * (`maskable: false`, since the value could continue past the space) is a
   * real overlap between two rules that disagree. Verified against the actual
   * `scanForSecrets` output, not reasoned about: each case below collapses to
   * exactly one merged match.
   */
  describe("mergeOverlaps ANDs maskable across every span it folds together", () => {
    const onlyMatch = (text: string): SecretMatch => {
      const matches = scanForSecrets(text).matches;
      expect(matches).toHaveLength(1);
      return matches[0];
    };

    /**
     * Same start, equal end: `aws-access-key-id` (priority 80, `maskable:
     * true`) sorts before `credential-assignment` (priority 60, `maskable:
     * false`) and the assignment span is CONTAINED (`candidate.end <=
     * last.end`) — the branch that DROPS the candidate and must still lower
     * the kept span's flag.
     */
    it("contained branch: a dropped false span lowers a kept true span", () => {
      const text = `aws_key=${AWS_DOC_ACCESS_KEY_ID} more`;
      const match = onlyMatch(text);
      expect(text.slice(match.start, match.end)).toBe(AWS_DOC_ACCESS_KEY_ID);
      expect(match.maskable).toBe(false);
    });

    /**
     * Same construction, sort order reversed: `credential-assignment` starts
     * one character before the AKIA-shaped value it contains (`xyz-` prefix,
     * a non-word separator so the fixed-shape rule still matches), so it
     * sorts first as the KEPT span and the true-maskable AWS match is the one
     * CONTAINED and dropped.
     */
    it("contained branch, reversed sort order: a dropped true span cannot raise a kept false span", () => {
      const text = `aws_key=xyz-${AWS_DOC_ACCESS_KEY_ID} more`;
      const match = onlyMatch(text);
      expect(text.slice(match.start, match.end)).toBe(`xyz-${AWS_DOC_ACCESS_KEY_ID}`);
      expect(match.maskable).toBe(false);
    });

    /**
     * Same start as the first case, but the assignment's unquoted value runs
     * past the AKIA key (`:suffix`) before the trailing space, so
     * `candidate.end > last.end` — the EXTENDING branch instead of the
     * contained one.
     */
    it("extending branch: a span that grows past a true one still comes out false", () => {
      const text = `aws_key=${AWS_DOC_ACCESS_KEY_ID}:suffix more`;
      const match = onlyMatch(text);
      expect(text.slice(match.start, match.end)).toBe(`${AWS_DOC_ACCESS_KEY_ID}:suffix`);
      expect(match.maskable).toBe(false);
    });
  });

  describe("invariants", () => {
    const busyText = [
      `Authorization: Basic ${RFC7617_BASIC}`,
      `aws_access_key_id = ${AWS_DOC_ACCESS_KEY_ID}`,
      `AWS_SECRET_ACCESS_KEY=${AWS_DOC_SECRET_ACCESS_KEY}`,
      `postgres://admin:s3cr3tP4ss@db.internal:5432/app`,
      JWT_IO_CANONICAL,
      pemBlock("EC"),
      STRIPE_DOC_TEST_KEY,
      STRIPE_DOC_PUBLISHABLE_KEY,
    ].join("\n");

    it("carries no matched text on a match", () => {
      for (const match of scanForSecrets(busyText, { highEntropyRule: true }).matches) {
        expect(Object.keys(match).sort()).toEqual([
          "end",
          "length",
          "maskable",
          "ruleId",
          "start",
        ]);
      }
    });

    it("reports length as end minus start", () => {
      for (const match of scanForSecrets(busyText, { highEntropyRule: true }).matches) {
        expect(match.length).toBe(match.end - match.start);
      }
    });

    it("returns non-overlapping spans in ascending order", () => {
      const matches = scanForSecrets(busyText, { highEntropyRule: true }).matches;
      for (let index = 1; index < matches.length; index += 1) {
        expect(matches[index].start).toBeGreaterThanOrEqual(matches[index - 1].end);
      }
    });

    it("is deterministic across repeated scans", () => {
      expect(scanForSecrets(busyText, { highEntropyRule: true })).toEqual(
        scanForSecrets(busyText, { highEntropyRule: true }),
      );
    });

    it("finds nothing in ordinary prose", () => {
      const prose =
        "Could you please rewrite this paragraph so it sounds more confident? " +
        "The meeting is on Tuesday and I want to summarize the three decisions we made.";
      expect(scanForSecrets(prose, { highEntropyRule: true })).toEqual({ matches: [], ruleIds: [] });
    });

    it("finds nothing in Japanese prose", () => {
      const prose = "この段落をもっと自然な日本語に直してください。会議は火曜日です。";
      expect(scanForSecrets(prose, { highEntropyRule: true })).toEqual({ matches: [], ruleIds: [] });
    });

    it("returns nothing for empty text", () => {
      expect(scanForSecrets("")).toEqual({ matches: [], ruleIds: [] });
    });
  });
});
