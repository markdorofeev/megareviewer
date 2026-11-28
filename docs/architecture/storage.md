# Storage

SQLite at `~/.megareviewer/db.sqlite`:

| Table | Holds |
|---|---|
| `analyses` | host, repo, PR number, head SHA, pipeline version, status, result JSON |
| `point_reviews` | analysis, point ID, state (open / raised / dismissed), updated time |
| `published_comments` | analysis, publication number, comment key (a line or the summary; a decision on old ones), host comment ID, published time |
| `publications` | analysis, number, the ID the page chose for it, review URL, published time |
| `file_contents` | host, repo, commit SHA, path, content (or none, when the file isn't at that commit), fetched time |
| `thread_posts` | analysis, kind (a reply or a comment posted now), posted time |
| `preferences` | ID, kind (look-for / dont-flag), text, scope (a repository, or none for everywhere), source (written / learned / imported), enabled, created and updated times |
| `preference_proposals` | ID, kind, text, scope, source (learned / imported), evidence lines, status (pending / accepted / rejected), created time |
| `review_signals` | what made it (its key), kind (dismissed / raised / comment), time, PR, the point's kind, title, text, file |
| `guideline_switches` | host, owner, repo, path of a guideline file or any other file of the harness, enabled |
| `last_model_option` | the model option the last model call used, and when |
| `known_checkouts` | host, owner, repo, folder it was read from, last read time |
| `harnesses` | host, owner, repo, commit SHA, loaded time, the limit that cut it, the files skipped with why, the paths that weren't there |
| `harness_files` | a harness's files in order: path, blob hash, bytes, lines, how it was found, the first file that links it, headings, its links to the others |
| `harness_blobs` | host, owner, repo, blob hash, content, last used time |

The pipeline version changes whenever prompts or schemas change, which invalidates cached analyses.

megareviewer's copies of repositories are beside the database, in `~/.megareviewer/repos` (see [megareviewer's own copy](local-checkout.md#megareviewers-own-copy)).

The four preference tables don't reference `analyses`: a preference is for every pull request, and a signal outlives its analysis. Nor does `known_checkouts`: a folder is the repository's, for any pull request. Nor do the harness's: a harness is for every pull request on its base commit.

`file_contents` keeps every file fetched from a host. A file at a commit never changes, so an analysis that failed partway, or another analysis of the same commits, doesn't fetch it again. Rows older than 30 days are dropped when megareviewer starts. A file over 1 MB isn't kept, because the analysis doesn't use it.

