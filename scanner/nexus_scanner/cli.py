"""Command line entry point: ``agent-nexus-scan aws ...``"""
from __future__ import annotations

import argparse
import sys
from typing import Any

from . import __version__
from . import model as M


def _aws_session(args: argparse.Namespace) -> Any:
    import boto3

    base = boto3.Session(profile_name=args.profile) if args.profile else boto3.Session()
    if not args.role_arn:
        return base
    kw = {"RoleArn": args.role_arn, "RoleSessionName": "agent-nexus-scan", "DurationSeconds": 3600}
    if args.external_id:
        kw["ExternalId"] = args.external_id
    c = base.client("sts").assume_role(**kw)["Credentials"]
    return boto3.Session(aws_access_key_id=c["AccessKeyId"], aws_secret_access_key=c["SecretAccessKey"],
                         aws_session_token=c["SessionToken"])


def run_aws(args: argparse.Namespace) -> int:
    from botocore.config import Config
    from .aws import AwsScanner

    session = _aws_session(args)
    cfg = Config(retries={"mode": "adaptive", "max_attempts": 8}, user_agent_extra=f"agent-nexus-scanner/{__version__}",
                 connect_timeout=10, read_timeout=30)
    account = session.client("sts").get_caller_identity()["Account"]
    regions = args.regions.split(",") if args.regions else sorted(session.get_available_regions("bedrock"))
    clients: dict[tuple[str, str], Any] = {}

    def client(service: str, region: str) -> Any:
        if (service, region) not in clients:
            clients[(service, region)] = session.client(service, region_name=region, config=cfg)
        return clients[(service, region)]

    def available(service: str, region: str) -> bool:
        try:
            return region in session.get_available_regions(service)
        except Exception:
            return True

    log = (lambda m: print(m, file=sys.stderr)) if not args.quiet else None
    scanner = AwsScanner(client, regions, account=account,
                         home_regions=args.home_regions.split(",") if args.home_regions else None,
                         days=args.days, max_events=args.max_events,
                         skip=args.skip.split(",") if args.skip else (), probe_agent_cards=args.probe_agent_cards,
                         available=available, log=log)
    inv = scanner.run()
    out = inv.to_json()
    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            f.write(out)
    else:
        print(out)
    print(summary(inv), file=sys.stderr)
    return 2 if args.fail_on and any(_rank(f.severity) <= _rank(args.fail_on) for f in inv.findings) else 0


def _rank(sev: str) -> int:
    return M.SEVERITIES.index(sev)


def summary(inv: M.Inventory) -> str:
    d = inv.to_dict()
    lines = [f"\nAgent Nexus scan · AWS account {inv.account} · {len(inv.regions)} regions"]
    for kind, n in sorted(d["summary"]["assets"].items()):
        lines.append(f"  {kind:<16} {n}")
    lines.append("Findings: " + ", ".join(f"{n} {s}" for s, n in d["summary"]["findings"].items() if n) if inv.findings else "Findings: none")
    for f in d["findings"][:15]:
        lines.append(f"  [{f['severity'].upper():<8}] {f['title']}")
    if inv.errors:
        lines.append(f"{len(inv.errors)} calls failed (see 'errors' in the output); usually missing permissions.")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="agent-nexus-scan", description="Read-only discovery of AI agents, MCP servers and models.")
    p.add_argument("--version", action="version", version=__version__)
    sub = p.add_subparsers(dest="platform", required=True)
    a = sub.add_parser("aws", help="Scan one AWS account")
    a.add_argument("--profile", help="AWS CLI profile to start from")
    a.add_argument("--role-arn", help="Read-only role to assume (from iam/agent-nexus-readonly.yaml)")
    a.add_argument("--external-id", help="External ID required by the role's trust policy")
    a.add_argument("--regions", help="Comma-separated regions (default: every region with Bedrock)")
    a.add_argument("--home-regions", help="Allowed regions for residency checks, e.g. ap-southeast-2,ap-southeast-4")
    a.add_argument("--days", type=int, default=30, help="Look-back window for usage (max 90 for CloudTrail)")
    a.add_argument("--max-events", type=int, default=5000, help="CloudTrail events to read per region")
    a.add_argument("--skip", help="Comma-separated steps to skip: agents,agentcore,models,sagemaker,ecs,cloudtrail")
    a.add_argument("--probe-agent-cards", action="store_true", help="HTTP GET /.well-known/agent-card.json on API Gateway APIs")
    a.add_argument("--fail-on", choices=M.SEVERITIES, help="Exit 2 if any finding at or above this severity (for CI)")
    a.add_argument("--out", help="Write the JSON inventory here instead of stdout")
    a.add_argument("--quiet", action="store_true")
    args = p.parse_args(argv)
    return run_aws(args)


if __name__ == "__main__":
    sys.exit(main())
