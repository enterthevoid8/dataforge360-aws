import sys
from awsglue.context import GlueContext
from awsglue.job import Job
from awsglue.utils import getResolvedOptions
from pyspark.context import SparkContext
from pyspark.sql.functions import (
    col,
    current_timestamp,
    lit,
    to_timestamp,
    year,
    month,
    dayofmonth,
    hour,
    coalesce
)

args = getResolvedOptions(
    sys.argv,
    [
        "JOB_NAME",
        "RAW_EVENTS_PATH",
        "CURATED_EVENTS_PATH"
    ]
)

sc = SparkContext()
glue_context = GlueContext(sc)
spark = glue_context.spark_session

job = Job(glue_context)
job.init(args["JOB_NAME"], args)

raw_events_path = args["RAW_EVENTS_PATH"]
curated_events_path = args["CURATED_EVENTS_PATH"]

print(f"Reading raw events from: {raw_events_path}")
print(f"Writing curated parquet to: {curated_events_path}")

df = (
    spark.read
    .option("recursiveFileLookup", "true")
    .json(raw_events_path)
)

if df.rdd.isEmpty():
    print("No raw events found. Exiting job.")
    job.commit()
    sys.exit(0)

# Normalize common fields. Missing fields become null.
normalized_df = (
    df
    .withColumn("event_type", coalesce(col("eventType"), lit("UNKNOWN_EVENT")))
    .withColumn("user_id", col("userId"))
    .withColumn("session_id", col("sessionId"))
    .withColumn("product_id", col("productId"))
    .withColumn("order_id", col("orderId"))
    .withColumn("source", col("source"))
    .withColumn(
        "event_timestamp",
        coalesce(
            to_timestamp(col("receivedAt")),
            to_timestamp(col("timestamp")),
            current_timestamp()
        )
    )
    .withColumn("processed_at", current_timestamp())
)

partitioned_df = (
    normalized_df
    .withColumn("event_year", year(col("event_timestamp")))
    .withColumn("event_month", month(col("event_timestamp")))
    .withColumn("event_day", dayofmonth(col("event_timestamp")))
    .withColumn("event_hour", hour(col("event_timestamp")))
)

selected_df = partitioned_df.select(
    "event_type",
    "user_id",
    "session_id",
    "product_id",
    "order_id",
    "source",
    "event_timestamp",
    "processed_at",
    "payload",
    "event_year",
    "event_month",
    "event_day",
    "event_hour"
)

(
    selected_df.write
    .mode("append")
    .partitionBy("event_year", "event_month", "event_day", "event_hour")
    .parquet(curated_events_path)
)

print("Glue ETL job completed successfully.")

job.commit()