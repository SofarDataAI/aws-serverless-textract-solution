import { S3Client, CopyObjectCommand, CopyObjectCommandInput } from "@aws-sdk/client-s3";
import { DeleteMessageCommand, SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { SQSEvent } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';

const S3_PDF_FILES_BUCKET_NAME = process.env.S3_PDF_FILES_BUCKET_NAME;
const S3_FILE_TRANSFER_QUEUE_URL = process.env.S3_FILE_TRANSFER_QUEUE_URL;

const sqsClient = new SQSClient({});
const s3Client = new S3Client({});

/**
 * The handler function processes messages from an SQS queue that contain S3 event notifications.
 * It copies the S3 objects referenced in the notifications to a different bucket and deletes the
 * messages from the queue after processing.
 *
 * @param {SQSEvent} event - The event object containing an array of SQS messages.
 * @returns {Promise<void>} A promise that resolves when all messages have been processed.
 */
export const handler = async (event: SQSEvent): Promise<void> => {
    const correlationId = uuidv4();
    const method = 's3-file-transfer.handler';
    const prefix = `${correlationId} - ${method}`;
    console.log(`${prefix} - started.`);

    // print out number items in event.Records
    console.log(`${prefix} - sqsEvent.Records.length: ${event.Records.length}`);

    // print out event.Records
    console.log(`${prefix} - sqsEvent.Records: ${JSON.stringify(event.Records)}`);

    const sqsEventRecords = event.Records;

    for (const sqsEventRecord of sqsEventRecords) {
        console.log(`${prefix} - event body: ${sqsEventRecord.body}`);
        const s3Event = JSON.parse(sqsEventRecord.body) as S3Event;

        // print out s3Event
        console.log(`s3Event: ${JSON.stringify(s3Event)}`);

        if (s3Event !== undefined && Array.isArray(s3Event.Records)) {
            const s3EventRecords = s3Event.Records;
            // print out first item in s3EventRecords
            console.log(`${prefix} - s3EventRecords[0]: ${JSON.stringify(s3EventRecords[0])}`);

            // print out number items in s3EventRecords
            console.log(`${prefix} - s3EventRecords.length: ${s3EventRecords.length}`);

            for (const s3EventRecord of s3EventRecords) {
                // print out s3EventRecord
                console.log(`${prefix} - s3EventRecord: ${JSON.stringify(s3EventRecord)}`);

                const sourceBucket = s3EventRecord.s3.bucket.name;
                const sourceKey = s3EventRecord.s3.object.key;

                if (sourceBucket === undefined || sourceKey === undefined) throw new Error('bucketName or objectKey is undefined.');

                try {
                    // Generate a hash with date month year as a prefix of object key
                    const copyObjectKey = sourceKey;

                    // Copy the object to the new bucket
                    const destinationBucket = S3_PDF_FILES_BUCKET_NAME;
                    if (destinationBucket === undefined) throw new Error('Environment variable S3_PDF_FILES_BUCKET_NAME is not set.');

                    // copy object from source bucket to destination bucket
                    const copyObjectParams: CopyObjectCommandInput = {
                        Bucket: destinationBucket,
                        CopySource: `${sourceBucket}/${sourceKey}`,
                        Key: copyObjectKey,
                    };
                    await s3Client.send(new CopyObjectCommand(copyObjectParams));

                    // delete messsage from queue url known as S3_FILE_TRANSFER_QUEUE_URL
                    const fileTransferQueueUrl = S3_FILE_TRANSFER_QUEUE_URL;
                    if (fileTransferQueueUrl === undefined) throw new Error('Environment variable S3_FILE_TRANSFER_QUEUE_URL is not set.');
                    const deleteMessageCommand = new DeleteMessageCommand({
                        QueueUrl: fileTransferQueueUrl,
                        ReceiptHandle: sqsEventRecord.receiptHandle,
                    });
                    await sqsClient.send(deleteMessageCommand);

                    console.log(`${prefix} - Deleted SQS message for object key: ${sourceKey}, bucket name: ${sourceBucket}, from : ${fileTransferQueueUrl}`);
                } catch (error) {
                    console.error(`${prefix} - Error processing S3 object key: ${sourceKey}, bucket name: ${sourceBucket}:`, error);
                }
            }
        }
        else {
            console.log(`${prefix} - s3Event is undefined or s3Event.Records is not an array.`);
            throw new Error('s3Event is undefined or s3Event.Records is not an array.');
        }
    }
};

/**
 * Represents a single record in an S3 event notification.
 */
interface S3EventRecord {
    s3: {
        s3SchemaVersion: string;
        configurationId: string;
        bucket: {
            name: string;
            ownerIdentity: {
                principalId: string;
            };
            arn: string;
        };
        object: {
            key: string;
            size: number;
            eTag: string;
            versionId?: string | undefined;
            sequencer: string;
        };
    };
}

/**
 * Represents the structure of an S3 event notification which may contain one or more records.
 */
interface S3Event {
    Records: S3EventRecord[];
}
