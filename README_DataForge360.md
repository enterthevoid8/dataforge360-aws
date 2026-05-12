# DataForge360 AWS Production-Style Analytics Lab

DataForge360 is a production-style AWS learning project that builds an end-to-end ecommerce analytics platform using:

- KMS
- S3
- CloudTrail
- VPC
- Private EC2
- RDS PostgreSQL
- ECR
- ECS Fargate
- Kinesis Data Streams
- Data Firehose
- AWS Glue
- Redshift Serverless
- Amazon QuickSight / Amazon Quick

The final pipeline is:

```text
Node.js ECS API
   ↓
RDS PostgreSQL for transactional data
   ↓
Kinesis Data Stream
   ↓
Data Firehose
   ↓
S3 Raw Zone
   ↓
Glue Crawler
   ↓
Glue ETL Job
   ↓
S3 Curated Parquet Zone
   ↓
Glue Curated Catalog
   ↓
Redshift Serverless / Spectrum
   ↓
QuickSight Dashboard
```

---

## 0. Prerequisites

Install/configure:

```powershell
aws --version
docker --version
node --version
npm --version
```

Login/configure AWS:

```powershell
aws login
aws sts get-caller-identity
```

Use region:

```powershell
$AWS_REGION="ap-south-1"
$ACCOUNT_ID="908844378431"
$PROJECT_NAME="DataForge360"
$ENVIRONMENT="Dev"
$RESOURCE_PREFIX="dataforge360-dev"
$OWNER="Lalit"
$COST_CENTER="Learning"
```

---

## 1. Create KMS Stack

File:

```text
01-dataforge360-kms.yaml
```

Deploy:

```powershell
aws cloudformation deploy `
  --template-file 01-dataforge360-kms.yaml `
  --stack-name dataforge360-dev-kms `
  --region ap-south-1 `
  --capabilities CAPABILITY_NAMED_IAM `
  --parameter-overrides `
    ProjectName=DataForge360 `
    Environment=Dev `
    ResourcePrefix=dataforge360-dev `
    Owner=Lalit `
    CostCenter=Learning `
  --tags `
    Project=DataForge360 `
    Environment=Dev `
    Owner=Lalit `
    CostCenter=Learning `
    AutoDelete=True `
    ManagedBy=CloudFormation
```

---

## 2. Create S3 + CloudTrail Stack

File:

```text
02-dataforge360-s3-cloudtrail.yaml
```

Deploy:

```powershell
aws cloudformation deploy `
  --template-file 02-dataforge360-s3-cloudtrail.yaml `
  --stack-name dataforge360-dev-s3-cloudtrail `
  --region ap-south-1 `
  --parameter-overrides `
    ProjectName=DataForge360 `
    Environment=Dev `
    ResourcePrefix=dataforge360-dev `
    Owner=Lalit `
    CostCenter=Learning `
  --tags `
    Project=DataForge360 `
    Environment=Dev `
    Owner=Lalit `
    CostCenter=Learning `
    AutoDelete=True `
    ManagedBy=CloudFormation
```

Create folder placeholders:

```powershell
$ACCOUNT_ID="908844378431"

$RAW_BUCKET="dataforge360-dev-raw-$ACCOUNT_ID"
$CURATED_BUCKET="dataforge360-dev-curated-$ACCOUNT_ID"
$ARTIFACTS_BUCKET="dataforge360-dev-artifacts-$ACCOUNT_ID"

$RAW_FOLDERS=@("orders/","customers/","products/","payments/","events/","ad_spend/","inventory/")
$CURATED_FOLDERS=@("orders_parquet/","customers_parquet/","products_parquet/","events_parquet/","customer_360/","daily_revenue/","marketing_funnel/")
$ARTIFACTS_FOLDERS=@("scripts/","glue-jobs/","lambda-zips/","ecs/")

foreach ($folder in $RAW_FOLDERS) {
  aws s3api put-object --bucket $RAW_BUCKET --key $folder
}

foreach ($folder in $CURATED_FOLDERS) {
  aws s3api put-object --bucket $CURATED_BUCKET --key $folder
}

foreach ($folder in $ARTIFACTS_FOLDERS) {
  aws s3api put-object --bucket $ARTIFACTS_BUCKET --key $folder
}
```

Verify:

```powershell
aws s3 ls s3://dataforge360-dev-raw-908844378431/
aws s3 ls s3://dataforge360-dev-curated-908844378431/
aws s3 ls s3://dataforge360-dev-artifacts-908844378431/
```

---

## 3. Create VPC + Private EC2 + EC2 Instance Connect

File:

```text
03-dataforge360-vpc-ec2connect.yaml
```

Deploy:

```powershell
aws cloudformation deploy `
  --template-file 03-dataforge360-vpc-ec2connect.yaml `
  --stack-name dataforge360-dev-vpc-ec2connect `
  --region ap-south-1 `
  --capabilities CAPABILITY_NAMED_IAM `
  --parameter-overrides `
    ProjectName=DataForge360 `
    Environment=Dev `
    ResourcePrefix=dataforge360-dev `
    Owner=Lalit `
    CostCenter=Learning `
    InstanceType=t3.small `
  --tags `
    Project=DataForge360 `
    Environment=Dev `
    Owner=Lalit `
    CostCenter=Learning `
    AutoDelete=True `
    ManagedBy=CloudFormation
```

---

## 4. Create RDS PostgreSQL

File:

```text
04-dataforge360-rds-postgres.yaml
```

Important settings used in this lab:

- `EngineVersion: "16.13"`
- `BackupRetentionPeriod: 0`
- `DB_SSL=true` in ECS

Deploy:

```powershell
aws cloudformation deploy `
  --template-file 04-dataforge360-rds-postgres.yaml `
  --stack-name dataforge360-dev-rds-postgres `
  --region ap-south-1 `
  --capabilities CAPABILITY_NAMED_IAM `
  --parameter-overrides `
    ProjectName=DataForge360 `
    Environment=Dev `
    ResourcePrefix=dataforge360-dev `
    Owner=Lalit `
    CostCenter=Learning `
    DBInstanceClass=db.t3.micro `
    DBAllocatedStorage=30 `
    DBName=dataforge360db `
    DBUsername=dataforgeadmin `
  --tags `
    Project=DataForge360 `
    Environment=Dev `
    Owner=Lalit `
    CostCenter=Learning `
    AutoDelete=True `
    ManagedBy=CloudFormation
```

---

## 5. Create ECR Repository

File:

```text
05-dataforge360-ecr.yaml
```

Deploy:

```powershell
aws cloudformation deploy `
  --template-file 05-dataforge360-ecr.yaml `
  --stack-name dataforge360-dev-ecr `
  --region ap-south-1 `
  --parameter-overrides `
    ProjectName=DataForge360 `
    Environment=Dev `
    ResourcePrefix=dataforge360-dev `
    Owner=Lalit `
    CostCenter=Learning `
  --tags `
    Project=DataForge360 `
    Environment=Dev `
    Owner=Lalit `
    CostCenter=Learning `
    AutoDelete=True `
    ManagedBy=CloudFormation
```

---

## 6. Build and Push Node.js Backend API

Backend folder:

```text
backend-api
```

Install:

```powershell
cd backend-api
npm install
npm install @aws-sdk/client-kinesis
```

Build Docker image:

```powershell
docker build -t dataforge360-dev-backend-api .
```

Login to ECR:

```powershell
$AWS_REGION="ap-south-1"
$ACCOUNT_ID="908844378431"
$ECR_URI="908844378431.dkr.ecr.ap-south-1.amazonaws.com/dataforge360-dev-backend-api"

aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin "$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com"
```

Tag and push:

```powershell
docker tag dataforge360-dev-backend-api:latest "${ECR_URI}:latest"
docker push "${ECR_URI}:latest"
```

---

## 7. Deploy ECS Fargate + ALB

File:

```text
06-dataforge360-ecs-fargate.yaml
```

Deploy:

```powershell
cd C:\Users\lalit\Documents\dataforge360-aws

aws cloudformation deploy `
  --template-file 06-dataforge360-ecs-fargate.yaml `
  --stack-name dataforge360-dev-ecs-fargate `
  --region ap-south-1 `
  --capabilities CAPABILITY_NAMED_IAM `
  --parameter-overrides `
    ProjectName=DataForge360 `
    Environment=Dev `
    ResourcePrefix=dataforge360-dev `
    Owner=Lalit `
    CostCenter=Learning `
    DesiredCount=1 `
    TaskCpu=512 `
    TaskMemory=1024 `
  --tags `
    Project=DataForge360 `
    Environment=Dev `
    Owner=Lalit `
    CostCenter=Learning `
    AutoDelete=True `
    ManagedBy=CloudFormation
```

Get API URL:

```powershell
$API_URL = aws cloudformation describe-stacks `
  --stack-name dataforge360-dev-ecs-fargate `
  --region ap-south-1 `
  --query "Stacks[0].Outputs[?OutputKey=='BackendApiUrl'].OutputValue" `
  --output text

echo $API_URL
```

Test:

```powershell
curl "$API_URL/health"
curl "$API_URL/ready"
```

---

## 8. Initialize RDS Data from API

Initialize DB schema:

```powershell
Invoke-RestMethod `
  -Method POST `
  -Uri "$API_URL/api/admin/init-db" `
  -Headers @{ "x-admin-token" = "dataforge360-dev-admin-token" }
```

Seed data:

```powershell
Invoke-RestMethod `
  -Method POST `
  -Uri "$API_URL/api/admin/seed-data" `
  -Headers @{ "x-admin-token" = "dataforge360-dev-admin-token" }
```

Test:

```powershell
Invoke-RestMethod "$API_URL/api/customers"
Invoke-RestMethod "$API_URL/api/products"
Invoke-RestMethod "$API_URL/api/orders"
```

---

## 9. Create Kinesis + Firehose

File:

```text
07-dataforge360-kinesis-firehose.yaml
```

Deploy:

```powershell
aws cloudformation deploy `
  --template-file 07-dataforge360-kinesis-firehose.yaml `
  --stack-name dataforge360-dev-kinesis-firehose `
  --region ap-south-1 `
  --capabilities CAPABILITY_NAMED_IAM `
  --parameter-overrides `
    ProjectName=DataForge360 `
    Environment=Dev `
    ResourcePrefix=dataforge360-dev `
    Owner=Lalit `
    CostCenter=Learning `
  --tags `
    Project=DataForge360 `
    Environment=Dev `
    Owner=Lalit `
    CostCenter=Learning `
    AutoDelete=True `
    ManagedBy=CloudFormation
```

Test CLI event:

```powershell
aws kinesis put-record `
  --stream-name dataforge360-dev-events-stream `
  --partition-key user-101 `
  --data "eyJldmVudFR5cGUiOiJQUk9EVUNUX1ZJRVdFRCIsInVzZXJJZCI6InUtMTAxIiwicHJvZHVjdElkIjoicC01MDEiLCJzb3VyY2UiOiJ0ZXN0LWNsaSIsInRpbWVzdGFtcCI6IjIwMjYtMDUtMTFUMTA6MDA6MDBaIn0K" `
  --region ap-south-1
```

Wait 60–90 seconds:

```powershell
aws s3 ls s3://dataforge360-dev-raw-908844378431/events/kinesis/ --recursive
```

Test API event:

```powershell
Invoke-RestMethod `
  -Method POST `
  -Uri "$API_URL/api/events" `
  -ContentType "application/json" `
  -Body '{"eventType":"ADD_TO_CART","userId":"u-201","productId":"p-901","source":"ecs-api-test"}'
```

---

## 10. Create Raw Glue Crawler

File:

```text
08-dataforge360-glue-crawler.yaml
```

Deploy:

```powershell
aws cloudformation deploy `
  --template-file 08-dataforge360-glue-crawler.yaml `
  --stack-name dataforge360-dev-glue-crawler `
  --region ap-south-1 `
  --capabilities CAPABILITY_NAMED_IAM `
  --parameter-overrides `
    ProjectName=DataForge360 `
    Environment=Dev `
    ResourcePrefix=dataforge360-dev `
    Owner=Lalit `
    CostCenter=Learning `
  --tags `
    Project=DataForge360 `
    Environment=Dev `
    Owner=Lalit `
    CostCenter=Learning `
    AutoDelete=True `
    ManagedBy=CloudFormation
```

Run crawler:

```powershell
aws glue start-crawler `
  --name dataforge360-dev-raw-events-crawler `
  --region ap-south-1
```

Check tables:

```powershell
aws glue get-tables `
  --database-name dataforge360-dev_raw_db `
  --region ap-south-1 `
  --query "TableList[].Name"
```

---

## 11. Create Glue ETL Job

Create script:

```text
glue-scripts/raw_events_to_parquet.py
```

Upload:

```powershell
aws s3 cp `
  .\glue-scripts\raw_events_to_parquet.py `
  s3://dataforge360-dev-artifacts-908844378431/glue-jobs/raw_events_to_parquet.py
```

CloudFormation file:

```text
09-dataforge360-glue-etl.yaml
```

Deploy:

```powershell
aws cloudformation deploy `
  --template-file 09-dataforge360-glue-etl.yaml `
  --stack-name dataforge360-dev-glue-etl `
  --region ap-south-1 `
  --capabilities CAPABILITY_NAMED_IAM `
  --parameter-overrides `
    ProjectName=DataForge360 `
    Environment=Dev `
    ResourcePrefix=dataforge360-dev `
    Owner=Lalit `
    CostCenter=Learning `
  --tags `
    Project=DataForge360 `
    Environment=Dev `
    Owner=Lalit `
    CostCenter=Learning `
    AutoDelete=True `
    ManagedBy=CloudFormation
```

Run ETL:

```powershell
aws glue start-job-run `
  --job-name dataforge360-dev-raw-events-to-parquet `
  --region ap-south-1
```

Check output:

```powershell
aws s3 ls s3://dataforge360-dev-curated-908844378431/events_parquet/ --recursive
```

---

## 12. Create Curated Glue Crawler

File:

```text
10-dataforge360-curated-crawler.yaml
```

Deploy:

```powershell
aws cloudformation deploy `
  --template-file 10-dataforge360-curated-crawler.yaml `
  --stack-name dataforge360-dev-curated-crawler `
  --region ap-south-1 `
  --capabilities CAPABILITY_NAMED_IAM `
  --parameter-overrides `
    ProjectName=DataForge360 `
    Environment=Dev `
    ResourcePrefix=dataforge360-dev `
    Owner=Lalit `
    CostCenter=Learning `
  --tags `
    Project=DataForge360 `
    Environment=Dev `
    Owner=Lalit `
    CostCenter=Learning `
    AutoDelete=True `
    ManagedBy=CloudFormation
```

Run curated crawler:

```powershell
aws glue start-crawler `
  --name dataforge360-dev-curated-events-crawler `
  --region ap-south-1
```

Check table:

```powershell
aws glue get-tables `
  --database-name dataforge360-dev_curated_db `
  --region ap-south-1 `
  --query "TableList[].Name"
```

---

## 13. Create Redshift Serverless

File:

```text
11-dataforge360-redshift-serverless.yaml
```

Important:

- Use password without `/`, `@`, `"`, space, `\`, `'`
- `EnhancedVpcRouting: false` for 2-subnet setup

Deploy:

```powershell
aws cloudformation deploy `
  --template-file 11-dataforge360-redshift-serverless.yaml `
  --stack-name dataforge360-dev-redshift-serverless `
  --region ap-south-1 `
  --capabilities CAPABILITY_NAMED_IAM `
  --parameter-overrides `
    ProjectName=DataForge360 `
    Environment=Dev `
    ResourcePrefix=dataforge360-dev `
    Owner=Lalit `
    CostCenter=Learning `
    RedshiftDbName=dev `
    RedshiftAdminUsername=dataforgeadmin `
    RedshiftAdminPassword=DataForge360Redshift123! `
  --tags `
    Project=DataForge360 `
    Environment=Dev `
    Owner=Lalit `
    CostCenter=Learning `
    AutoDelete=True `
    ManagedBy=CloudFormation
```

Create external schema:

```powershell
$REDSHIFT_ROLE_ARN = aws cloudformation describe-stacks `
  --stack-name dataforge360-dev-redshift-serverless `
  --region ap-south-1 `
  --query "Stacks[0].Outputs[?OutputKey=='RedshiftSpectrumRoleArn'].OutputValue" `
  --output text

$SQL = @"
CREATE EXTERNAL SCHEMA spectrum_curated
FROM DATA CATALOG
DATABASE 'dataforge360-dev_curated_db'
IAM_ROLE '$REDSHIFT_ROLE_ARN';
"@

$QUERY_ID = aws redshift-data execute-statement `
  --workgroup-name dataforge360-dev-rs-workgroup `
  --database dev `
  --sql "$SQL" `
  --region ap-south-1 `
  --query "Id" `
  --output text
```

Test:

```powershell
$SQL = "select * from spectrum_curated.events_parquet limit 10;"

$QUERY_ID = aws redshift-data execute-statement `
  --workgroup-name dataforge360-dev-rs-workgroup `
  --database dev `
  --sql "$SQL" `
  --region ap-south-1 `
  --query "Id" `
  --output text

Start-Sleep -Seconds 10

aws redshift-data get-statement-result `
  --id $QUERY_ID `
  --region ap-south-1
```

---

## 14. Create Redshift Warehouse Tables and Views

Create `fact_events`:

```powershell
$SQL = @"
DROP TABLE IF EXISTS fact_events CASCADE;

CREATE TABLE fact_events AS
SELECT
  event_type,
  user_id,
  session_id,
  product_id,
  order_id,
  source,
  event_timestamp,
  processed_at,
  event_year,
  event_month,
  event_day,
  event_hour
FROM spectrum_curated.events_parquet;
"@

$QUERY_ID = aws redshift-data execute-statement `
  --workgroup-name dataforge360-dev-rs-workgroup `
  --database dev `
  --sql "$SQL" `
  --region ap-south-1 `
  --query "Id" `
  --output text
```

Create sales tables:

```powershell
$SQL = @"
DROP TABLE IF EXISTS fact_orders;
DROP TABLE IF EXISTS dim_products;
DROP TABLE IF EXISTS dim_customers;

CREATE TABLE dim_customers (
  customer_name VARCHAR(200),
  city VARCHAR(100),
  state VARCHAR(100),
  total_orders INTEGER,
  total_revenue DECIMAL(12,2)
);

CREATE TABLE dim_products (
  product_name VARCHAR(200),
  category VARCHAR(100),
  price DECIMAL(12,2),
  stock_quantity INTEGER
);

CREATE TABLE fact_orders (
  order_id VARCHAR(100),
  customer_name VARCHAR(200),
  city VARCHAR(100),
  state VARCHAR(100),
  order_status VARCHAR(50),
  total_amount DECIMAL(12,2),
  source_channel VARCHAR(100),
  created_at TIMESTAMP
);
"@

$QUERY_ID = aws redshift-data execute-statement `
  --workgroup-name dataforge360-dev-rs-workgroup `
  --database dev `
  --sql "$SQL" `
  --region ap-south-1 `
  --query "Id" `
  --output text
```

Insert business data:

```powershell
$SQL = @"
INSERT INTO dim_customers
(customer_name, city, state, total_orders, total_revenue)
VALUES
('Aarav Sharma', 'Jaipur', 'Rajasthan', 1, 2499.00),
('Neha Verma', 'Pune', 'Maharashtra', 1, 11998.00),
('Rahul Mehta', 'Noida', 'Uttar Pradesh', 1, 10497.00),
('Priya Nair', 'Bengaluru', 'Karnataka', 1, 35996.00),
('Karan Singh', 'Delhi', 'Delhi', 1, 8995.00);

INSERT INTO dim_products
(product_name, category, price, stock_quantity)
VALUES
('Wireless Headphones', 'Electronics', 2499.00, 120),
('Smart Watch', 'Electronics', 5999.00, 80),
('Running Shoes', 'Fashion', 3499.00, 150),
('Office Chair', 'Furniture', 8999.00, 45),
('Backpack', 'Travel', 1799.00, 200);

INSERT INTO fact_orders
(order_id, customer_name, city, state, order_status, total_amount, source_channel, created_at)
VALUES
('ord-001', 'Aarav Sharma', 'Jaipur', 'Rajasthan', 'COMPLETED', 2499.00, 'meta_ads', GETDATE()),
('ord-002', 'Neha Verma', 'Pune', 'Maharashtra', 'COMPLETED', 11998.00, 'google_search', GETDATE()),
('ord-003', 'Rahul Mehta', 'Noida', 'Uttar Pradesh', 'COMPLETED', 10497.00, 'direct', GETDATE()),
('ord-004', 'Priya Nair', 'Bengaluru', 'Karnataka', 'COMPLETED', 35996.00, 'influencer', GETDATE()),
('ord-005', 'Karan Singh', 'Delhi', 'Delhi', 'COMPLETED', 8995.00, 'email', GETDATE());
"@

$QUERY_ID = aws redshift-data execute-statement `
  --workgroup-name dataforge360-dev-rs-workgroup `
  --database dev `
  --sql "$SQL" `
  --region ap-south-1 `
  --query "Id" `
  --output text
```

Create BI views:

```powershell
$SQL = @"
CREATE OR REPLACE VIEW vw_sales_summary AS
SELECT
  source_channel,
  COUNT(order_id) AS total_orders,
  SUM(total_amount) AS total_revenue,
  AVG(total_amount) AS avg_order_value
FROM fact_orders
GROUP BY source_channel;

CREATE OR REPLACE VIEW vw_state_revenue AS
SELECT
  state,
  COUNT(order_id) AS total_orders,
  SUM(total_amount) AS total_revenue
FROM fact_orders
GROUP BY state;

CREATE OR REPLACE VIEW vw_event_summary AS
SELECT
  event_type,
  source,
  COUNT(*) AS total_events,
  COUNT(DISTINCT user_id) AS unique_users
FROM fact_events
GROUP BY event_type, source;

CREATE OR REPLACE VIEW vw_event_funnel AS
SELECT
  user_id,
  MAX(CASE WHEN event_type = 'PRODUCT_VIEWED' THEN 1 ELSE 0 END) AS viewed_product,
  MAX(CASE WHEN event_type = 'ADD_TO_CART' THEN 1 ELSE 0 END) AS added_to_cart,
  MAX(CASE WHEN event_type = 'PURCHASE_COMPLETED' THEN 1 ELSE 0 END) AS purchased
FROM fact_events
WHERE user_id IS NOT NULL
GROUP BY user_id;
"@

$QUERY_ID = aws redshift-data execute-statement `
  --workgroup-name dataforge360-dev-rs-workgroup `
  --database dev `
  --sql "$SQL" `
  --region ap-south-1 `
  --query "Id" `
  --output text
```

---

## 15. QuickSight

### 15.1 Manual one-time VPC connection

Create QuickSight VPC connection:

- VPC: `dataforge360-dev-vpc`
- Subnets:
  - `dataforge360-dev-private-data-subnet-a`
  - `dataforge360-dev-private-data-subnet-b`
- Security group:
  - `dataforge360-dev-quicksight-sg`

If QuickSight execution role needs permissions, attach this inline policy to:

```text
aws-quicksight-service-role-v0
```

Policy file:

```text
quicksight-vpc-policy.json
```

Apply:

```powershell
aws iam put-role-policy `
  --role-name aws-quicksight-service-role-v0 `
  --policy-name DataForge360QuickSightVpcConnectionPolicy `
  --policy-document file://quicksight-vpc-policy.json
```

Create QuickSight SG if needed:

```powershell
aws ec2 create-security-group `
  --group-name dataforge360-dev-quicksight-sg `
  --description "QuickSight VPC connection security group" `
  --vpc-id <DATAFORGE360_VPC_ID> `
  --region ap-south-1
```

Allow Redshift inbound from QuickSight SG:

```powershell
aws ec2 authorize-security-group-ingress `
  --group-id <REDSHIFT_SG_ID> `
  --protocol tcp `
  --port 5439 `
  --source-group <QUICKSIGHT_SG_ID> `
  --region ap-south-1
```

### 15.2 Create QuickSight datasets from YAML

File:

```text
12-dataforge360-quicksight-datasets-only.yaml
```

Get variables:

```powershell
aws quicksight list-users `
  --aws-account-id 908844378431 `
  --namespace default `
  --region ap-south-1

aws quicksight list-vpc-connections `
  --aws-account-id 908844378431 `
  --region ap-south-1

$REDSHIFT_ENDPOINT = aws redshift-serverless get-workgroup `
  --workgroup-name dataforge360-dev-rs-workgroup `
  --region ap-south-1 `
  --query "workgroup.endpoint.address" `
  --output text
```

Set variables:

```powershell
$QS_USER_ARN="arn:aws:quicksight:ap-south-1:908844378431:user/default/<YOUR_USER>"
$QS_VPC_CONNECTION_ARN="arn:aws:quicksight:ap-south-1:908844378431:vpcConnection/dataforge360-dev-quicksight-vpc"
```

Deploy:

```powershell
aws cloudformation deploy `
  --template-file 12-dataforge360-quicksight-datasets-only.yaml `
  --stack-name dataforge360-dev-quicksight-datasets `
  --region ap-south-1 `
  --capabilities CAPABILITY_NAMED_IAM `
  --parameter-overrides `
    ProjectName=DataForge360 `
    Environment=Dev `
    ResourcePrefix=dataforge360-dev `
    Owner=Lalit `
    CostCenter=Learning `
    QuickSightUserArn=$QS_USER_ARN `
    QuickSightVpcConnectionArn=$QS_VPC_CONNECTION_ARN `
    RedshiftEndpointAddress=$REDSHIFT_ENDPOINT `
    RedshiftDatabase=dev `
    RedshiftAdminUsername=dataforgeadmin `
    RedshiftAdminPassword=DataForge360Redshift123! `
  --tags `
    Project=DataForge360 `
    Environment=Dev `
    Owner=Lalit `
    CostCenter=Learning `
    AutoDelete=True `
    ManagedBy=CloudFormation
```

### 15.3 Create QuickSight dashboard manually

In QuickSight:

```text
Analyses → New analysis
```

Add datasets:

- `dataforge360-dev-sales-summary-ds`
- `dataforge360-dev-state-revenue-ds`
- `dataforge360-dev-event-summary-ds`
- `dataforge360-dev-funnel-summary-ds`

Recommended sheets:

1. Executive Overview
2. Event Analytics
3. Customer Funnel

Publish:

```text
Share → Publish dashboard → DataForge360 Analytics Dashboard
```

---

## Useful Verification Commands

List stacks:

```powershell
aws cloudformation list-stacks `
  --region ap-south-1 `
  --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE `
  --query "StackSummaries[?contains(StackName, 'dataforge360')].[StackName,StackStatus]" `
  --output table
```

Check S3 raw events:

```powershell
aws s3 ls s3://dataforge360-dev-raw-908844378431/events/kinesis/ --recursive
```

Check curated Parquet:

```powershell
aws s3 ls s3://dataforge360-dev-curated-908844378431/events_parquet/ --recursive
```

Check ECS service:

```powershell
aws ecs describe-services `
  --cluster dataforge360-dev-ecs-cluster `
  --services dataforge360-dev-backend-service `
  --region ap-south-1 `
  --query "services[0].[status,desiredCount,runningCount]"
```

Force ECS pull latest image:

```powershell
aws ecs update-service `
  --cluster dataforge360-dev-ecs-cluster `
  --service dataforge360-dev-backend-service `
  --force-new-deployment `
  --region ap-south-1
```

---

## Cost Control

Scale ECS down:

```powershell
aws ecs update-service `
  --cluster dataforge360-dev-ecs-cluster `
  --service dataforge360-dev-backend-service `
  --desired-count 0 `
  --region ap-south-1
```

Delete expensive temporary stacks:

```powershell
aws cloudformation delete-stack --stack-name dataforge360-dev-redshift-serverless --region ap-south-1
aws cloudformation delete-stack --stack-name dataforge360-dev-kinesis-firehose --region ap-south-1
```

Main idle cost resources:

- NAT Gateway
- ALB
- ECS Fargate task
- RDS
- EC2
- Kinesis shard
- Redshift Serverless when active
