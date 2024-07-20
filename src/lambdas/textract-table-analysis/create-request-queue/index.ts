import { DeleteMessageCommand, SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { StartDocumentAnalysisCommand, TextractClient } from '@aws-sdk/client-textract';
import { SQSEvent } from 'aws-lambda';
import { retry } from '@lifeomic/attempt';
import { v4 as uuidv4 } from 'uuid';

const textractClient = new TextractClient({});
const TEXTRACT_RESULT_QUEUE_URL = process.env.TEXTRACT_RESULT_QUEUE_URL;
const TEXTRACT_QUEUE_URL = process.env.TEXTRACT_QUEUE_URL;
const sqsClient = new SQSClient({});

/**
 * Lambda function handler to receive the result of a Textract job for table analysis.
 * It retrieves the analysis result, processes it to extract tables, and stores the result in S3.
 * If the job fails, it sends a message to a dead letter queue.
 *
 * @param {SQSEvent} event - The SQS event with details about the Textract job completion.
 * @returns {Promise<void>} A promise that resolves when the function has completed.
 */
export const handler = async (event: SQSEvent): Promise<void> => {
    const correlationId = uuidv4();
    const method = 'textract-create-request-queue.handler';
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

                const bucketName = s3EventRecord.s3.bucket.name;
                const objectKey = s3EventRecord.s3.object.key;

                if (bucketName === undefined || objectKey === undefined) throw new Error('bucketName or objectKey is undefined.');

                try {
                    await retry(async (_context) =>  {
                        console.log(`${prefix} - preparing processing for bucketName: ${bucketName}, objectKey: ${objectKey}`);
                        // Start the document analysis job for key-value pairs
                        const startDocumentAnalysisCommand = new StartDocumentAnalysisCommand({
                            DocumentLocation: {
                                S3Object: {
                                    Bucket: bucketName,
                                    Name: objectKey,
                                }
                            },
                            FeatureTypes: ['TABLES'], // Use "TABLES" to extract tables
                        });
                        const startDocumentAnalysisResponse = await textractClient.send(startDocumentAnalysisCommand);

                        const jobId = startDocumentAnalysisResponse.JobId;
                        if (jobId === undefined) throw new Error('JobId is undefined.');
                        console.log(`${prefix} - Job ID from Textract service: ${jobId}`);

                        if (startDocumentAnalysisResponse === undefined || jobId === undefined) {
                            throw new Error("Can not get JobId from textract service");
                        }

                        // Send a message to the SQS queue with the job ID
                        const sendMessageCommand = new SendMessageCommand({
                            QueueUrl: TEXTRACT_RESULT_QUEUE_URL,
                            MessageBody: JSON.stringify({
                                JobId: jobId,
                                ObjectKey: objectKey,
                                BucketName: bucketName,
                            }),
                        });
                        await sqsClient.send(sendMessageCommand);

                        console.log(`${prefix} - Sent SQS message for job ID ${jobId}, message content: ${JSON.stringify({
                            JobId: jobId,
                            ObjectKey: objectKey,
                            BucketName: bucketName,
                        })}, to : ${TEXTRACT_RESULT_QUEUE_URL}`);

                        // delete messsage from queue url known as TEXTRACT_QUEUE_URL
                        const deleteMessageCommand = new DeleteMessageCommand({
                            QueueUrl: TEXTRACT_QUEUE_URL,
                            ReceiptHandle: sqsEventRecord.receiptHandle,
                        });
                        await sqsClient.send(deleteMessageCommand);
                        console.log("Complete retry")
                        console.log(`${prefix} - Deleted SQS message for job ID ${jobId}, from : ${TEXTRACT_QUEUE_URL}`);
                    }, {
                        maxAttempts: 3,
                        handleError: async (err, _context) => {
                            console.error(`${prefix} - Error processing S3 object ${objectKey} from bucket ${bucketName}:`, err);
                            throw new Error(`${prefix} - Error processing S3 object ${objectKey} from bucket ${bucketName}: ${err}`);
                        },
                    });
                } catch (error) {
                    console.error(`${prefix} - Error processing S3 object ${objectKey} from bucket ${bucketName}:`, error);
                }
            }
        }
        else {
            console.log(`${prefix} - s3Event is undefined or s3Event.Records is not an array.`);
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
