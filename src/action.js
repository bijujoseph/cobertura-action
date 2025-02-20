const core = require("@actions/core");
const github = require("@actions/github");
const { processCoverage } = require("./cobertura");

const client = new github.GitHub(
  core.getInput("repo_token", { required: true })
);
const credits = "Generated by :monkey: cobertura-action";

async function action(payload) {
  const { pullRequestNumber, commit } = await pullRequestInfo(payload);
  if (!pullRequestNumber || !commit) {
    core.error("Found no pull request.");
    return;
  }

  const path = core.getInput("path", { required: true });
  const skipCovered = JSON.parse(
    core.getInput("skip_covered", { required: true })
  );
  const showLine = JSON.parse(core.getInput("show_line", { required: true }));
  const showBranch = JSON.parse(
    core.getInput("show_branch", { required: true })
  );
  const minimumCoverage = parseInt(
    core.getInput("minimum_coverage", { required: true })
  );
  const showClassNames = JSON.parse(
    core.getInput("show_class_names", { required: true })
  );
  const onlyChangedFiles = JSON.parse(
    core.getInput("only_changed_files", { required: true })
  );
  const reportName = core.getInput("report_name", { required: false });

  const changedFiles = onlyChangedFiles
    ? await listChangedFiles(pullRequestNumber)
    : null;

  const report = await processCoverage(path, { skipCovered });
  const comment = markdownReport(report, commit, {
    minimumCoverage,
    showLine,
    showBranch,
    showClassNames,
    filteredFiles: changedFiles,
    reportName
  });
  await addComment(pullRequestNumber, comment, reportName);
}

function markdownReport(report, commit, options) {
  const {
    minimumCoverage = 100,
    showLine = false,
    showBranch = false,
    showClassNames = false,
    filteredFiles = null,
    reportName = "Coverage Report"
  } = options || {};
  const status = total =>
    total >= minimumCoverage ? ":white_check_mark:" : ":x:";
  // Setup files
  const files = [];
  for (const file of report.files.filter(
    file => filteredFiles == null || filteredFiles.includes(file.filename)
  )) {
    const fileTotal = Math.round(file.total);
    const fileLines = Math.round(file.line);
    const fileBranch = Math.round(file.branch);
    files.push([
      showClassNames ? file.name : file.filename,
      `\`${fileTotal}%\``,
      showLine ? `\`${fileLines}%\`` : undefined,
      showBranch ? `\`${fileBranch}%\`` : undefined,
      status(fileTotal)
    ]);
  }
  // Construct table
  /*
  | File          | Coverage |                    |
  |---------------|:--------:|:------------------:|
  | **All files** | `78%`    | :x:                |
  | foo.py        | `80%`    | :white_check_mark: |
  | bar.py        | `75%`    | :x:                |

  _Minimum allowed coverage is `80%`_
  */

  const total = Math.round(report.total);
  const linesTotal = Math.round(report.line);
  const branchTotal = Math.round(report.branch);
  const table = [
    [
      "File",
      "Coverage",
      showLine ? "Lines" : undefined,
      showBranch ? "Branches" : undefined,
      " "
    ],
    [
      "-",
      ":-:",
      showLine ? ":-:" : undefined,
      showBranch ? ":-:" : undefined,
      ":-:"
    ],
    [
      "**All files**",
      `\`${total}%\``,
      showLine ? `\`${linesTotal}%\`` : undefined,
      showBranch ? `\`${branchTotal}%\`` : undefined,
      status(total)
    ],
    ...files
  ]
    .map(row => {
      return `| ${row.filter(Boolean).join(" | ")} |`;
    })
    .join("\n");
  const minimumCoverageText = `_Minimum allowed coverage is \`${minimumCoverage}%\`_`;
  const footerText = `<p align="right">${credits} against ${commit} </p>`;
  const titleText = `<strong>${reportName}</strong>`;
  return `${titleText}\n\n${table}\n\n${minimumCoverageText}\n\n${footerText}`;
}

async function addComment(pullRequestNumber, body, reportName) {
  const comments = await client.issues.listComments({
    issue_number: pullRequestNumber,
    ...github.context.repo
  });
  const commentFilter = reportName ? reportName : credits;
  const comment = comments.data.find(comment =>
    comment.body.includes(commentFilter)
  );
  if (comment != null) {
    await client.issues.updateComment({
      comment_id: comment.id,
      body: body,
      ...github.context.repo
    });
  } else {
    await client.issues.createComment({
      issue_number: pullRequestNumber,
      body: body,
      ...github.context.repo
    });
  }
}

async function listChangedFiles(pullRequestNumber) {
  const files = await client.pulls.listFiles({
    pull_number: pullRequestNumber,
    ...github.context.repo
  });
  return files.data.map(file => file.filename);
}

/**
 *
 * @param payload
 * @returns {Promise<{pullRequestNumber: number, commit: null}>}
 */
async function pullRequestInfo(payload = {}) {
  let commit = null;
  let pullRequestNumber = core.getInput("pull_request_number", {
    required: false
  });

  if (pullRequestNumber) {
    // use the supplied PR
    pullRequestNumber = parseInt(pullRequestNumber);
    const { data } = await client.pulls.get({
      pull_number: pullRequestNumber,
      ...github.context.repo
    });
    commit = data.head.sha;
  } else if (payload.workflow_run) {
    // fetch all open PRs and match the commit hash.
    commit = payload.workflow_run.head_commit.id;
    const { data } = await client.pulls.list({
      ...github.context.repo,
      state: "open"
    });
    pullRequestNumber = data
      .filter(d => d.head.sha == commit)
      .reduce((n, d) => d.number, "");
  } else if (payload.pull_request) {
    // try to find the PR from payload
    const { pull_request: pullRequest } = payload;
    pullRequestNumber = pullRequest.number;
    commit = pullRequest.head.sha;
  }

  return { pullRequestNumber, commit };
}

module.exports = {
  action,
  markdownReport,
  addComment,
  listChangedFiles
};
