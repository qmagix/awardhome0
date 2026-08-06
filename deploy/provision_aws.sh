#!/usr/bin/env bash
# Provision AWS infrastructure for AwardHome. Run LOCALLY with awscli
# configured (aws configure / SSO). Creates, idempotently:
#   - S3 backup bucket (name gets your account id appended for uniqueness)
#   - IAM role "awardhome-ec2" + instance profile with access to that bucket
#   - EC2 key pair (PEM saved next to this script)
#   - Security group (22 from your IP, 80/443 from anywhere)
#   - Ubuntu 24.04 EC2 instance with the role attached + Elastic IP
#
# Usage:
#   ./deploy/provision_aws.sh                # defaults below
#   REGION=us-west-2 INSTANCE_TYPE=t3.medium ./deploy/provision_aws.sh
#
# Everything is tagged/named "awardhome"; re-running reuses existing pieces.
set -euo pipefail

REGION="${REGION:-us-east-1}"
INSTANCE_TYPE="${INSTANCE_TYPE:-t3.small}"
NAME="${NAME:-awardhome}"
VOLUME_GB="${VOLUME_GB:-30}"

export AWS_DEFAULT_REGION="$REGION"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
BUCKET="${BUCKET:-awardhome-backups-$ACCOUNT_ID}"
ROLE_NAME="$NAME-ec2"
PROFILE_NAME="$NAME-ec2"
SG_NAME="$NAME-sg"
KEY_NAME="$NAME-key"
PEM_FILE="$(dirname "$0")/$KEY_NAME.pem"

echo "==> Account $ACCOUNT_ID, region $REGION"

# ---------- S3 bucket ----------
if aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
  echo "==> Bucket s3://$BUCKET exists"
else
  echo "==> Creating bucket s3://$BUCKET"
  if [ "$REGION" = "us-east-1" ]; then
    aws s3api create-bucket --bucket "$BUCKET"
  else
    aws s3api create-bucket --bucket "$BUCKET" \
      --create-bucket-configuration LocationConstraint="$REGION"
  fi
  aws s3api put-public-access-block --bucket "$BUCKET" \
    --public-access-block-configuration \
    BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
fi

# ---------- IAM role + instance profile ----------
if aws iam get-role --role-name "$ROLE_NAME" >/dev/null 2>&1; then
  echo "==> IAM role $ROLE_NAME exists"
else
  echo "==> Creating IAM role $ROLE_NAME"
  aws iam create-role --role-name "$ROLE_NAME" --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{ "Effect": "Allow",
      "Principal": { "Service": "ec2.amazonaws.com" },
      "Action": "sts:AssumeRole" }]
  }' >/dev/null
fi

echo "==> Attaching S3 policy for s3://$BUCKET"
aws iam put-role-policy --role-name "$ROLE_NAME" --policy-name "$NAME-s3-backups" \
  --policy-document "{
    \"Version\": \"2012-10-17\",
    \"Statement\": [
      { \"Effect\": \"Allow\",
        \"Action\": [\"s3:GetObject\", \"s3:PutObject\", \"s3:DeleteObject\"],
        \"Resource\": \"arn:aws:s3:::$BUCKET/*\" },
      { \"Effect\": \"Allow\",
        \"Action\": [\"s3:ListBucket\"],
        \"Resource\": \"arn:aws:s3:::$BUCKET\" }
    ]
  }"

if aws iam get-instance-profile --instance-profile-name "$PROFILE_NAME" >/dev/null 2>&1; then
  echo "==> Instance profile $PROFILE_NAME exists"
else
  aws iam create-instance-profile --instance-profile-name "$PROFILE_NAME" >/dev/null
  aws iam add-role-to-instance-profile --instance-profile-name "$PROFILE_NAME" --role-name "$ROLE_NAME"
  echo "==> Created instance profile; waiting for IAM propagation"
  sleep 10
fi

# ---------- key pair ----------
if aws ec2 describe-key-pairs --key-names "$KEY_NAME" >/dev/null 2>&1; then
  echo "==> Key pair $KEY_NAME exists (PEM expected at $PEM_FILE)"
else
  echo "==> Creating key pair $KEY_NAME -> $PEM_FILE"
  aws ec2 create-key-pair --key-name "$KEY_NAME" \
    --query KeyMaterial --output text > "$PEM_FILE"
  chmod 400 "$PEM_FILE"
fi

# ---------- security group ----------
VPC_ID=$(aws ec2 describe-vpcs --filters Name=is-default,Values=true --query 'Vpcs[0].VpcId' --output text)
SG_ID=$(aws ec2 describe-security-groups --filters Name=group-name,Values="$SG_NAME" Name=vpc-id,Values="$VPC_ID" \
  --query 'SecurityGroups[0].GroupId' --output text 2>/dev/null || true)
if [ "$SG_ID" = "None" ] || [ -z "$SG_ID" ]; then
  echo "==> Creating security group $SG_NAME"
  SG_ID=$(aws ec2 create-security-group --group-name "$SG_NAME" \
    --description "AwardHome web + ssh" --vpc-id "$VPC_ID" --query GroupId --output text)
  MY_IP=$(curl -fsS https://checkip.amazonaws.com)/32
  aws ec2 authorize-security-group-ingress --group-id "$SG_ID" --protocol tcp --port 22 --cidr "$MY_IP" >/dev/null
  aws ec2 authorize-security-group-ingress --group-id "$SG_ID" --protocol tcp --port 80 --cidr 0.0.0.0/0 >/dev/null
  aws ec2 authorize-security-group-ingress --group-id "$SG_ID" --protocol tcp --port 443 --cidr 0.0.0.0/0 >/dev/null
  echo "    ssh allowed from $MY_IP only"
else
  echo "==> Security group $SG_NAME exists ($SG_ID)"
fi

# ---------- EC2 instance ----------
EXISTING=$(aws ec2 describe-instances \
  --filters Name=tag:Name,Values="$NAME" Name=instance-state-name,Values=pending,running \
  --query 'Reservations[0].Instances[0].InstanceId' --output text 2>/dev/null || true)
if [ "$EXISTING" != "None" ] && [ -n "$EXISTING" ]; then
  echo "==> Instance already running: $EXISTING"
  INSTANCE_ID=$EXISTING
else
  AMI_ID=$(aws ssm get-parameter \
    --name /aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id \
    --query Parameter.Value --output text)
  echo "==> Launching $INSTANCE_TYPE from Ubuntu 24.04 AMI $AMI_ID"
  INSTANCE_ID=$(aws ec2 run-instances \
    --image-id "$AMI_ID" \
    --instance-type "$INSTANCE_TYPE" \
    --key-name "$KEY_NAME" \
    --security-group-ids "$SG_ID" \
    --iam-instance-profile Name="$PROFILE_NAME" \
    --metadata-options HttpTokens=required,HttpEndpoint=enabled \
    --block-device-mappings "[{\"DeviceName\":\"/dev/sda1\",\"Ebs\":{\"VolumeSize\":$VOLUME_GB,\"VolumeType\":\"gp3\"}}]" \
    --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$NAME}]" \
    --query 'Instances[0].InstanceId' --output text)
  echo "==> Waiting for instance $INSTANCE_ID to run"
  aws ec2 wait instance-running --instance-ids "$INSTANCE_ID"
fi

# ---------- Elastic IP ----------
EIP_ALLOC=$(aws ec2 describe-addresses --filters Name=tag:Name,Values="$NAME" \
  --query 'Addresses[0].AllocationId' --output text 2>/dev/null || true)
if [ "$EIP_ALLOC" = "None" ] || [ -z "$EIP_ALLOC" ]; then
  echo "==> Allocating Elastic IP"
  EIP_ALLOC=$(aws ec2 allocate-address \
    --tag-specifications "ResourceType=elastic-ip,Tags=[{Key=Name,Value=$NAME}]" \
    --query AllocationId --output text)
fi
aws ec2 associate-address --instance-id "$INSTANCE_ID" --allocation-id "$EIP_ALLOC" >/dev/null
PUBLIC_IP=$(aws ec2 describe-addresses --allocation-ids "$EIP_ALLOC" --query 'Addresses[0].PublicIp' --output text)

echo
echo "=========================================================="
echo "  Instance:   $INSTANCE_ID ($INSTANCE_TYPE, $REGION)"
echo "  Public IP:  $PUBLIC_IP  (Elastic — safe to put in DNS)"
echo "  S3 bucket:  s3://$BUCKET"
echo "  SSH:        ssh -i $PEM_FILE ubuntu@$PUBLIC_IP"
echo "=========================================================="
echo
echo "Next steps:"
echo "  1. Update litestream.yml: bucket: $BUCKET, region: $REGION"
echo "  2. Point Cloudflare DNS at $PUBLIC_IP"
echo "  3. On the instance, run deploy/setup_server.sh (see docs/deployment.md)"
