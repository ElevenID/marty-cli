/**
 * marty completion — generate shell completion scripts.
 *
 * Usage:
 *   eval "$(marty completion bash)"
 *   eval "$(marty completion zsh)"
 *   marty completion fish | source
 */

const BASH_SCRIPT = `
# marty bash completion
_marty_completions() {
  local cur prev commands subcommands
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"

  commands="auth health orgs credentials applications verify flows templates config test init completion"
  
  case "\${COMP_WORDS[1]}" in
    auth)
      subcommands="login logout whoami"
      ;;
    orgs)
      subcommands="list switch current"
      ;;
    credentials|creds)
      subcommands="list inspect revoke"
      ;;
    applications|apps)
      subcommands="list inspect apply submit withdraw claim approve reject request-info issue"
      ;;
    verify)
      subcommands="start status submit evaluate sessions inspect"
      ;;
    flows)
      subcommands="list inspect"
      ;;
    templates)
      subcommands="list inspect"
      ;;
    config)
      subcommands="show set"
      ;;
    test)
      subcommands="e2e health"
      ;;
    completion)
      subcommands="bash zsh fish"
      ;;
    *)
      subcommands=""
      ;;
  esac

  if [[ \${COMP_CWORD} -eq 1 ]]; then
    COMPREPLY=( $(compgen -W "\${commands}" -- "\${cur}") )
  elif [[ \${COMP_CWORD} -eq 2 && -n "\${subcommands}" ]]; then
    COMPREPLY=( $(compgen -W "\${subcommands}" -- "\${cur}") )
  else
    # Complete flags
    case "\${prev}" in
      --output|-o)
        COMPREPLY=( $(compgen -W "table json json-compact" -- "\${cur}") )
        ;;
      --scenario)
        COMPREPLY=( $(compgen -W "health issuance verification full" -- "\${cur}") )
        ;;
      *)
        local flags="--output --help --dry-run --version"
        COMPREPLY=( $(compgen -W "\${flags}" -- "\${cur}") )
        ;;
    esac
  fi
}
complete -F _marty_completions marty
`.trimStart();

const ZSH_SCRIPT = `
#compdef marty

# marty zsh completion
_marty() {
  local -a commands subcommands

  commands=(
    'auth:Manage authentication'
    'health:Check API health'
    'orgs:Manage organizations'
    'credentials:Manage credentials'
    'applications:Manage credential applications'
    'verify:Verification operations'
    'flows:Manage flows'
    'templates:View credential templates'
    'config:View and set config'
    'test:Test automation commands'
    'init:Interactive first-time setup'
    'completion:Generate shell completions'
  )

  _arguments -C \\
    '(-o --output)'{-o,--output}'[Output format]:format:(table json json-compact)' \\
    '--help[Show help]' \\
    '--version[Show version]' \\
    '1:command:->cmd' \\
    '*::arg:->args'

  case "$state" in
    cmd)
      _describe -t commands 'marty command' commands
      ;;
    args)
      case "\${words[1]}" in
        auth)
          subcommands=('login:Authenticate' 'logout:Clear credentials' 'whoami:Show auth status')
          _describe -t subcommands 'auth command' subcommands
          ;;
        orgs)
          subcommands=('list:List organizations' 'switch:Switch active org' 'current:Show current org')
          _describe -t subcommands 'orgs command' subcommands
          ;;
        credentials|creds)
          subcommands=('list:List credentials' 'inspect:Show credential details' 'revoke:Revoke a credential')
          _describe -t subcommands 'credentials command' subcommands
          ;;
        applications|apps)
          subcommands=('list:List applications' 'inspect:Show details' 'apply:Apply for credential' 'submit:Submit draft' 'withdraw:Withdraw application' 'claim:Claim offer' 'approve:Approve application' 'reject:Reject application' 'request-info:Request applicant information' 'issue:Initiate issuance')
          _describe -t subcommands 'applications command' subcommands
          ;;
        verify)
          subcommands=('start:Start session' 'status:Check status' 'submit:Submit presentation' 'evaluate:Evaluate credential' 'sessions:List sessions' 'inspect:Inspect session')
          _describe -t subcommands 'verify command' subcommands
          ;;
        flows)
          subcommands=('list:List flows' 'inspect:Show flow details')
          _describe -t subcommands 'flows command' subcommands
          ;;
        templates)
          subcommands=('list:List templates' 'inspect:Show template details')
          _describe -t subcommands 'templates command' subcommands
          ;;
        config)
          subcommands=('show:Show config' 'set:Set config value')
          _describe -t subcommands 'config command' subcommands
          ;;
        test)
          subcommands=('e2e:Run e2e tests' 'health:Quick health check')
          _describe -t subcommands 'test command' subcommands
          ;;
        completion)
          subcommands=('bash:Bash completions' 'zsh:Zsh completions' 'fish:Fish completions')
          _describe -t subcommands 'completion command' subcommands
          ;;
      esac
      ;;
  esac
}

_marty
`.trimStart();

const FISH_SCRIPT = `
# marty fish completion
set -l commands auth health orgs credentials applications verify flows templates config test init completion

# Disable file completion by default
complete -c marty -f

# Top-level commands
complete -c marty -n "not __fish_seen_subcommand_from $commands" -a auth -d "Manage authentication"
complete -c marty -n "not __fish_seen_subcommand_from $commands" -a health -d "Check API health"
complete -c marty -n "not __fish_seen_subcommand_from $commands" -a orgs -d "Manage organizations"
complete -c marty -n "not __fish_seen_subcommand_from $commands" -a credentials -d "Manage credentials"
complete -c marty -n "not __fish_seen_subcommand_from $commands" -a applications -d "Manage applications"
complete -c marty -n "not __fish_seen_subcommand_from $commands" -a verify -d "Verification operations"
complete -c marty -n "not __fish_seen_subcommand_from $commands" -a flows -d "Manage flows"
complete -c marty -n "not __fish_seen_subcommand_from $commands" -a templates -d "View templates"
complete -c marty -n "not __fish_seen_subcommand_from $commands" -a config -d "View/set config"
complete -c marty -n "not __fish_seen_subcommand_from $commands" -a test -d "Test automation"
complete -c marty -n "not __fish_seen_subcommand_from $commands" -a init -d "Interactive setup"
complete -c marty -n "not __fish_seen_subcommand_from $commands" -a completion -d "Shell completions"

# Subcommands
complete -c marty -n "__fish_seen_subcommand_from auth" -a "login logout whoami"
complete -c marty -n "__fish_seen_subcommand_from orgs" -a "list switch current"
complete -c marty -n "__fish_seen_subcommand_from credentials" -a "list inspect revoke"
complete -c marty -n "__fish_seen_subcommand_from applications" -a "list inspect apply submit withdraw claim approve reject request-info issue"
complete -c marty -n "__fish_seen_subcommand_from verify" -a "start status submit evaluate sessions inspect"
complete -c marty -n "__fish_seen_subcommand_from flows" -a "list inspect"
complete -c marty -n "__fish_seen_subcommand_from templates" -a "list inspect"
complete -c marty -n "__fish_seen_subcommand_from config" -a "show set"
complete -c marty -n "__fish_seen_subcommand_from test" -a "e2e health"
complete -c marty -n "__fish_seen_subcommand_from completion" -a "bash zsh fish"

# Global flags
complete -c marty -l output -s o -d "Output format" -a "table json json-compact"
complete -c marty -l help -d "Show help"
complete -c marty -l version -d "Show version"
complete -c marty -l dry-run -d "Dry run mode"
`.trimStart();

export function registerCompletionCommand(program) {
  const completion = program
    .command('completion')
    .description('Generate shell completion scripts')
    .argument('<shell>', 'Shell type: bash, zsh, or fish');

  completion.action((shell) => {
    switch (shell) {
      case 'bash':
        console.log(BASH_SCRIPT);
        break;
      case 'zsh':
        console.log(ZSH_SCRIPT);
        break;
      case 'fish':
        console.log(FISH_SCRIPT);
        break;
      default:
        console.error(`Unknown shell: ${shell}. Supported: bash, zsh, fish`);
        process.exit(1);
    }
  });
}
