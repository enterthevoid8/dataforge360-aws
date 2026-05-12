# DataForge360 Cleanup Script
# Run from PowerShell.
# Region: ap-south-1
# Account: 908844378431

$REGION="ap-south-1"
$ACCOUNT_ID="908844378431"

Write-Host "DataForge360 cleanup starting..." -ForegroundColor Cyan
Write-Host "This deletes CloudFormation stacks and manually-created QuickSight resources where possible." -ForegroundColor Yellow
Write-Host "Press Ctrl+C now if you do not want to continue."
Start-Sleep -Seconds 8

function Delete-Stack {
  param([string]$StackName)

  Write-Host "`nDeleting stack: $StackName" -ForegroundColor Cyan

  $exists = aws cloudformation describe-stacks `
    --stack-name $StackName `
    --region $REGION `
    --query "Stacks[0].StackName" `
    --output text 2>$null

  if (-not $exists -or $exists -eq "None") {
    Write-Host "Stack not found: $StackName" -ForegroundColor DarkYellow
    return
  }

  aws cloudformation delete-stack `
    --stack-name $StackName `
    --region $REGION

  aws cloudformation wait stack-delete-complete `
    --stack-name $StackName `
    --region $REGION

  Write-Host "Deleted stack: $StackName" -ForegroundColor Green
}

function Empty-Bucket {
  param([string]$BucketName)

  Write-Host "`nEmptying bucket: $BucketName" -ForegroundColor Cyan

  $exists = aws s3api head-bucket --bucket $BucketName 2>$null
  if ($LASTEXITCODE -ne 0) {
    Write-Host "Bucket not found or inaccessible: $BucketName" -ForegroundColor DarkYellow
    return
  }

  aws s3 rm "s3://$BucketName" --recursive

  Write-Host "Attempting to remove object versions/delete markers if versioning was enabled..." -ForegroundColor Yellow

  $versionsJson = aws s3api list-object-versions --bucket $BucketName --output json 2>$null
  if ($LASTEXITCODE -eq 0 -and $versionsJson) {
    $versions = ($versionsJson | ConvertFrom-Json)

    $objects = @()

    if ($versions.Versions) {
      foreach ($v in $versions.Versions) {
        $objects += @{ Key = $v.Key; VersionId = $v.VersionId }
      }
    }

    if ($versions.DeleteMarkers) {
      foreach ($m in $versions.DeleteMarkers) {
        $objects += @{ Key = $m.Key; VersionId = $m.VersionId }
      }
    }

    if ($objects.Count -gt 0) {
      $deletePayload = @{ Objects = $objects; Quiet = $true } | ConvertTo-Json -Depth 5
      $tmpFile = New-TemporaryFile
      Set-Content -Path $tmpFile -Value $deletePayload
      aws s3api delete-objects --bucket $BucketName --delete "file://$tmpFile"
      Remove-Item $tmpFile -Force
    }
  }

  Write-Host "Emptied bucket: $BucketName" -ForegroundColor Green
}

# 1. Scale ECS down first to stop tasks.
Write-Host "`nScaling ECS service to 0 if present..." -ForegroundColor Cyan
aws ecs update-service `
  --cluster dataforge360-dev-ecs-cluster `
  --service dataforge360-dev-backend-service `
  --desired-count 0 `
  --region $REGION 2>$null

# 2. Delete QuickSight datasets stack first.
Delete-Stack "dataforge360-dev-quicksight-datasets"

# 3. Delete manual QuickSight VPC connection if it exists.
Write-Host "`nDeleting QuickSight VPC connection if present..." -ForegroundColor Cyan
aws quicksight delete-vpc-connection `
  --aws-account-id $ACCOUNT_ID `
  --vpc-connection-id dataforge360-dev-quicksight-vpc `
  --region $REGION 2>$null

# 4. Delete expensive/upper-layer stacks first.
Delete-Stack "dataforge360-dev-redshift-serverless"
Delete-Stack "dataforge360-dev-curated-crawler"
Delete-Stack "dataforge360-dev-glue-etl"
Delete-Stack "dataforge360-dev-glue-crawler"
Delete-Stack "dataforge360-dev-kinesis-firehose"
Delete-Stack "dataforge360-dev-ecs-fargate"

# 5. Empty and delete ECR stack.
Write-Host "`nDeleting all ECR images if repository exists..." -ForegroundColor Cyan
$imageIds = aws ecr list-images `
  --repository-name dataforge360-dev-backend-api `
  --region $REGION `
  --query "imageIds" `
  --output json 2>$null

if ($LASTEXITCODE -eq 0 -and $imageIds -and $imageIds -ne "[]") {
  $tmpFile = New-TemporaryFile
  Set-Content -Path $tmpFile -Value $imageIds
  aws ecr batch-delete-image `
    --repository-name dataforge360-dev-backend-api `
    --image-ids "file://$tmpFile" `
    --region $REGION
  Remove-Item $tmpFile -Force
}

Delete-Stack "dataforge360-dev-ecr"

# 6. Delete RDS before VPC.
Delete-Stack "dataforge360-dev-rds-postgres"

# 7. Delete VPC stack.
Delete-Stack "dataforge360-dev-vpc-ec2connect"

# 8. Empty S3 buckets before deleting S3 stack.
Empty-Bucket "dataforge360-dev-raw-$ACCOUNT_ID"
Empty-Bucket "dataforge360-dev-curated-$ACCOUNT_ID"
Empty-Bucket "dataforge360-dev-artifacts-$ACCOUNT_ID"
Empty-Bucket "dataforge360-dev-logs-$ACCOUNT_ID"

Delete-Stack "dataforge360-dev-s3-cloudtrail"

# 9. Delete KMS stack last.
# KMS key deletion may be scheduled rather than immediately destroyed.
Delete-Stack "dataforge360-dev-kms"

# 10. Delete manually-created QuickSight SG if still present.
Write-Host "`nAttempting to delete manually-created QuickSight security group..." -ForegroundColor Cyan
$qsSgId = aws ec2 describe-security-groups `
  --region $REGION `
  --filters "Name=group-name,Values=dataforge360-dev-quicksight-sg" `
  --query "SecurityGroups[0].GroupId" `
  --output text 2>$null

if ($qsSgId -and $qsSgId -ne "None") {
  aws ec2 delete-security-group --group-id $qsSgId --region $REGION 2>$null
}

# 11. Remove inline QuickSight VPC role policy if desired.
Write-Host "`nRemoving QuickSight inline VPC policy if present..." -ForegroundColor Cyan
aws iam delete-role-policy `
  --role-name aws-quicksight-service-role-v0 `
  --policy-name DataForge360QuickSightVpcConnectionPolicy 2>$null

Write-Host "`nCleanup finished. Check CloudFormation, S3, EC2, Redshift, RDS, ECS, ECR, Glue, Kinesis, and QuickSight manually to confirm." -ForegroundColor Green
Write-Host "If you created QuickSight dashboards/analyses manually, delete them from QuickSight UI. If you want no QuickSight charges, cancel the QuickSight subscription from Manage Quick > Subscriptions." -ForegroundColor Yellow
