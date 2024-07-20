import os
import boto3
import img2pdf
from aws_lambda_powertools import Logger, Tracer
from aws_lambda_powertools.utilities.batch import (
    BatchProcessor,
    EventType,
    process_partial_response,
)
from aws_lambda_powertools.utilities.data_classes.sqs_event import SQSRecord
from botocore.exceptions import ClientError
from aws_lambda_powertools.utilities.typing import LambdaContext

logger = Logger()
processor = BatchProcessor(event_type=EventType.SQS)

s3_client = boto3.client('s3')
sqs_client = boto3.client('sqs')

S3_PDF_FILES_BUCKET_NAME = os.environ['S3_PDF_FILES_BUCKET_NAME']
S3_IMAGE_TRANSFER_QUEUE_URL = os.environ['S3_IMAGE_TRANSFER_QUEUE_URL']

processor = BatchProcessor(event_type=EventType.SQS)
tracer = Tracer()
logger = Logger()


@tracer.capture_method
def record_handler(record: SQSRecord):
    payload: str = record.json_body  # if json string data, otherwise record.body for str
    logger.info(payload)
    try:
        bucket = payload['Records'][0]['s3']['bucket']['name']
        key = payload['Records'][0]['s3']['object']['key']
        version_id = payload['Records'][0]['s3']['object'].get('versionId')

        # Download the image file from S3
        download_path = f"/tmp/{key.split('/')[-1]}"
        s3_client.download_file(bucket, key, download_path)

        # Convert image to PDF
        pdf_path = f"/tmp/{os.path.splitext(key.split('/')[-1])[0]}-{version_id}.pdf"
        with open(download_path, "rb") as image_file:
            pdf_bytes = img2pdf.convert(image_file)
            with open(pdf_path, "wb") as pdf_file:
                pdf_file.write(pdf_bytes)

        # Upload PDF to S3
        pdf_key = f"pdf/{os.path.basename(pdf_path)}"
        s3_client.upload_file(pdf_path, S3_PDF_FILES_BUCKET_NAME, pdf_key)

        # Delete the SQS message
        sqs_client.delete_message(
            QueueUrl=S3_IMAGE_TRANSFER_QUEUE_URL,
            ReceiptHandle=record.receipt_handle
        )

        logger.info(f"Successfully processed and converted {key} to PDF")
        return True

    except ClientError as e:
        logger.error(f"Error processing record: {e}")
        # throw the exception to propagate it to the next handler
        raise e
    except Exception as e:
        logger.error(f"Unexpected error processing record: {e}")
        # throw the exception to propagate it to the next handler
        raise e


@logger.inject_lambda_context
@tracer.capture_lambda_handler
def handler(event, context: LambdaContext):
    return process_partial_response(
        event=event,
        record_handler=record_handler,
        processor=processor,
        context=context,
    )
