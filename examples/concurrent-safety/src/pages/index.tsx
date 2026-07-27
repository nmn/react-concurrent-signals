import App from "../App";

export default async function HomePage() {
  return <App />;
}

export const getConfig = async () => {
  return {
    render: "static",
  } as const;
};
